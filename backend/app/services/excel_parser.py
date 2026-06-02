"""
Bank Statement Excel Parser
Parses Hebrew bank statement Excel files and extracts transactions.

Supports multiple bank export formats:
  - Standard / FibiBank: headers at row 0 or auto-detected; column names like
      'תאריך פעילות', 'תאור פעולה', 'זכות', 'חובה', 'יתרה'
  - FibiSave XLS: headers mid-file (e.g. row 4); columns 'תאור', 'תאריך', etc.
  - Leumi XLSX: 10 metadata rows before data; columns 'תיאור', 'בזכות', 'בחובה',
      'היתרה בש"ח', 'תאור מורחב' (has full payer name in extended description)
  - Leumi XLS: same structure as Leumi XLSX but exported as HTML disguised as XLS
  - Hapoalim XLSX: headers at row 4; columns 'תאריך', 'הפעולה' (short action), 'פרטים'
      (details with payer in "המבצע: NAME עבור: PURPOSE" pattern), 'חובה', 'זכות',
      "יתרה בש''ח" (note: two single quotes, not a double quote)
"""

import io
import re
import pandas as pd
from datetime import datetime
from typing import List, Dict, Optional, Tuple


# All known header-row keywords across all formats
HEADER_KEYWORDS: set = {
    'תאריך פעילות', 'תאריך תמצית', 'תאור פעולה', 'זכות', 'חובה', 'יתרה',
    'תאריך', 'תיאור', 'תאור', 'בזכות', 'בחובה', 'היתרה בש"ח', 'תאור מורחב',
    'אסמכתא', 'תאריך ערך', 'סוג פעולה',
    # Hapoalim format
    'קוד פעולה', 'הפעולה', 'פרטים', "יתרה בש''ח",
}


class BankStatementParser:
    """Parser for Israeli bank statement Excel files"""

    # Common bank names to identify and remove from descriptions
    BANK_NAMES = [
        'הפועלים', 'לאומי', 'דיסקונט', 'מזרחי', 'בינלאומי',
        'פועלים', 'איגוד', 'מרכנתיל', 'יהב', 'אוצר החייל',
        'אוצר-החייל', 'אוצר-חיל', 'אוצר החיל',
        'בנק', 'Bank'
    ]

    # Fee/expense keywords to filter out
    FEE_KEYWORDS = [
        'מע"מ', 'עמלה', 'עמלת', 'דמי ניהול', 'ניהול חשבון',
        'קנס', 'אגרה', 'בנקאות', 'סה"כ פעולות', 'סה"כ'
    ]

    def __init__(self):
        self.column_mappings = {
            # Standard / FibiBank format
            'תאריך פעילות': 'activity_date',
            'תאריך תמצית': 'statement_date',
            'אסמכתא': 'reference',
            'תאור פעולה': 'description',
            'זכות': 'credit',
            'חובה': 'debit',
            'יתרה': 'balance',
            # Leumi XLSX / Leumi XLS (HTML) format
            'תאריך': 'activity_date',
            'תאריך ערך': 'statement_date',
            'תיאור': 'description',
            'בזכות': 'credit',
            'בחובה': 'debit',
            'היתרה בש"ח': 'balance',
            'תאור מורחב': 'extended_description',
            # FibiSave XLS format (some columns overlap with above)
            'תאור': 'description',     # FibiSave uses short form
            'סוג פעולה': 'action_type',
            # Hapoalim XLSX format
            'הפעולה': 'description',
            'פרטים': 'details',
            "יתרה בש''ח": 'balance',
            'קוד פעולה': 'action_code',
        }

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def parse_excel(
        self,
        file_content: bytes,
        filename: str,
        return_all: bool = False
    ) -> Tuple[List[Dict], Dict]:
        """
        Parse bank statement Excel file.

        Args:
            file_content: Binary content of Excel file.
            filename: Original filename (used to pick engine).
            return_all: If True, return all transactions including fees/transfers.

        Returns:
            Tuple of (transactions list, metadata dict)
        """
        df = self._read_to_dataframe(file_content, filename)

        # Normalize column names (Hebrew → English)
        df = self._normalize_columns(df)

        # Extract metadata
        metadata = self._extract_metadata(df, filename)

        # Parse transactions
        transactions = self._parse_transactions(df)

        # Filter out fees and summary rows (unless caller wants everything)
        if not return_all:
            transactions = self._filter_transactions(transactions)

        return transactions, metadata

    # ------------------------------------------------------------------
    # File reading with format auto-detection
    # ------------------------------------------------------------------

    def _read_to_dataframe(self, file_content: bytes, filename: str) -> pd.DataFrame:
        """
        Read Excel/XLS file into a DataFrame with the correct header row.
        Handles:
          1. Standard XLSX (openpyxl)  — header auto-detected
          2. FibiSave real XLS (xlrd)  — header auto-detected
          3. Leumi XLS that is actually HTML  — parsed with read_html
        """
        lower = filename.lower()
        is_xls = lower.endswith('.xls') and not lower.endswith('.xlsx')

        if is_xls:
            df = self._read_xls(file_content, filename)
        else:
            df = self._read_xlsx(file_content)

        return df

    def _read_xlsx(self, file_content: bytes) -> pd.DataFrame:
        """Read a real XLSX file, auto-detecting the header row."""
        raw = pd.read_excel(io.BytesIO(file_content), header=None, engine='openpyxl')
        return self._detect_and_reread_header(raw, file_content, engine='openpyxl')

    def _read_xls(self, file_content: bytes, filename: str) -> pd.DataFrame:
        """
        Try to read XLS. Falls back to HTML parsing for bank exports
        that masquerade as XLS.
        """
        try:
            raw = pd.read_excel(io.BytesIO(file_content), header=None, engine='xlrd')
            return self._detect_and_reread_header(raw, file_content, engine='xlrd')
        except Exception:
            # File is not a real XLS — try HTML (Leumi-style export)
            return self._read_html_xls(file_content)

    def _detect_and_reread_header(
        self,
        raw: pd.DataFrame,
        file_content: bytes,
        engine: str,
    ) -> pd.DataFrame:
        """
        Scan the first 20 rows of *raw* (no-header read) for a header row,
        then re-read with that row as the column header.
        Falls back to row 0 if nothing is found.
        Always re-reads so that columns are named (not integer-indexed).
        """
        header_row = self._find_header_row(raw)
        return pd.read_excel(
            io.BytesIO(file_content),
            header=header_row,
            engine=engine,
        )

    def _find_header_row(self, raw: pd.DataFrame, max_scan: int = 20) -> int:
        """
        Return the 0-based index of the row that looks like a header.
        A row qualifies if it contains ≥ 2 known header keywords.
        Returns 0 (no skip) if nothing better is found.
        """
        best_row = 0
        best_score = 0

        for i in range(min(max_scan, len(raw))):
            row_vals = {
                str(v).strip()
                for v in raw.iloc[i].values
                if pd.notna(v) and str(v).strip()
            }
            score = len(row_vals & HEADER_KEYWORDS)
            if score > best_score:
                best_score = score
                best_row = i

        return best_row if best_score >= 2 else 0

    def _read_html_xls(self, file_content: bytes) -> pd.DataFrame:
        """
        Parse a Leumi-style XLS that is really an HTML document.
        Finds the table whose first few rows contain known header keywords,
        then promotes that row to the column header.
        """
        tables = pd.read_html(io.BytesIO(file_content), encoding='utf-8')

        # Sort by table size (largest first) so we find the transactions table first
        for table in sorted(tables, key=len, reverse=True):
            for i in range(min(5, len(table))):
                row_vals = {
                    str(v).strip()
                    for v in table.iloc[i].values
                    if pd.notna(v) and str(v).strip() != 'nan'
                }
                if len(row_vals & HEADER_KEYWORDS) >= 3:
                    # Promote this row to header
                    new_cols = list(table.iloc[i])
                    df = table.iloc[i + 1:].copy()
                    df.columns = new_cols
                    df = df.reset_index(drop=True)
                    return df

        # Last-resort: return the largest table as-is
        if tables:
            return max(tables, key=len)
        raise ValueError("No parseable tables found in HTML XLS file")

    # ------------------------------------------------------------------
    # Column normalization
    # ------------------------------------------------------------------

    def _normalize_columns(self, df: pd.DataFrame) -> pd.DataFrame:
        """Rename Hebrew column names to English equivalents."""
        column_map = {}
        for col in df.columns:
            col_str = str(col).strip()
            if col_str in self.column_mappings:
                column_map[col] = self.column_mappings[col_str]
        return df.rename(columns=column_map)

    # ------------------------------------------------------------------
    # Metadata extraction
    # ------------------------------------------------------------------

    def _extract_metadata(self, df: pd.DataFrame, filename: str) -> Dict:
        """Extract statement metadata (period, account, etc.)"""
        metadata = {
            'filename': filename,
            'row_count': len(df),
            'period_month': None,
            'period_year': None,
        }

        if 'activity_date' in df.columns:
            valid_dates = df['activity_date'].dropna()
            if len(valid_dates) > 0:
                if isinstance(valid_dates.iloc[0], str):
                    dates = pd.to_datetime(valid_dates, dayfirst=True, errors='coerce')
                else:
                    dates = pd.to_datetime(valid_dates, errors='coerce')

                dates = dates.dropna()
                if len(dates) > 0:
                    latest_date = dates.max()
                    metadata['period_month'] = latest_date.month
                    metadata['period_year'] = latest_date.year

        return metadata

    # ------------------------------------------------------------------
    # Transaction parsing
    # ------------------------------------------------------------------

    def _parse_transactions(self, df: pd.DataFrame) -> List[Dict]:
        """Parse individual transactions from the normalised DataFrame."""
        transactions = []

        for _, row in df.iterrows():
            # Must have a description
            raw_desc = row.get('description')
            if pd.isna(raw_desc):
                continue
            description = str(raw_desc).strip()
            if not description:
                continue

            # Must have a parseable date
            activity_date = self._parse_date(row.get('activity_date'))
            if not activity_date:
                continue

            credit = self._parse_amount(row.get('credit'))
            debit = self._parse_amount(row.get('debit'))
            balance = self._parse_amount(row.get('balance'))

            # Determine payer name — priority order:
            # 1. Extended description (Leumi format: "העברה מאת: NAME ACCOUNT NOTE")
            # 2. Details column (Hapoalim format: "המבצע: NAME עבור: PURPOSE ...")
            # 3. Label column (FibiSave format: pre-labelled tenant name)
            # 4. Regular description extraction (standard format: "BANK - NAME")
            ext = row.get('extended_description')
            details = row.get('details')
            label = row.get('label')

            if pd.notna(ext) and str(ext).strip():
                payer_name = self._extract_payer_from_extended(str(ext).strip())
            elif pd.notna(details) and str(details).strip():
                payer_name = self._extract_payer_from_details(str(details).strip())
            elif pd.notna(label) and str(label).strip():
                payer_name = str(label).strip()
            else:
                payer_name = self._extract_payer_name(description)

            # Preserve the raw extended description (Leumi 'תאור מורחב')
            # so callers/UI can surface the full payer/note text. Other
            # formats leave this as None.
            ext_value: Optional[str] = None
            if pd.notna(ext) and str(ext).strip():
                ext_value = str(ext).strip()

            transaction = {
                'activity_date': activity_date,
                'reference_number': str(row.get('reference', '')),
                'description': description,
                'extended_description': ext_value,
                'payer_name': payer_name,
                'credit_amount': credit,
                'debit_amount': debit,
                'balance': balance,
                'transaction_type': self._classify_transaction(description, credit, debit),
            }
            transactions.append(transaction)

        return transactions

    # ------------------------------------------------------------------
    # Payer name extraction helpers
    # ------------------------------------------------------------------

    def _extract_payer_from_extended(self, extended_desc: str) -> Optional[str]:
        """
        Extract payer name from Leumi extended description.

        Format: "העברה מאת: [name] [account-number] [optional note]"
        Account number pattern: digits-digits-digits, e.g. "12-746-000059916"
        """
        prefix = 'העברה מאת: '
        if prefix not in extended_desc:
            return extended_desc.strip() or None

        after_prefix = extended_desc[len(prefix):]

        # Account number looks like "12-746-000059916" or "31-008-105619405"
        match = re.search(r'\d{1,2}-\d{3}-\d+', after_prefix)
        if match:
            name = after_prefix[:match.start()].strip().rstrip(',').strip()
            return name if name else None

        return after_prefix.strip() or None

    def _extract_payer_from_details(self, details: str) -> Optional[str]:
        """
        Extract payer name from Hapoalim 'פרטים' (details) column.

        Incoming credit format: "המבצע: NAME עבור: PURPOSE [מח-ן:ACCOUNT]"
        Outgoing debit format: "לטובת: NAME עבור: PURPOSE" — outgoing transfers
            are normally filtered, but we still return the recipient name.
        """
        text = ' '.join(details.split())

        for prefix in ('המבצע:', 'לטובת:'):
            if prefix in text:
                after = text.split(prefix, 1)[1].strip()
                # Cut at "עבור:" if present, else at account-number marker
                end = len(after)
                for marker in ('עבור:', 'מח-ן:', 'מח -ן:'):
                    idx = after.find(marker)
                    if idx != -1 and idx < end:
                        end = idx
                name = after[:end].strip().rstrip(',').strip()
                return name or None

        return text or None

    def _extract_payer_name(self, description: str) -> Optional[str]:
        """
        Extract payer name from standard transaction description.
        Format: "[bank name]    -  [payer name]"
        """
        description = ' '.join(description.split())

        if ' - ' in description:
            parts = description.split(' - ', 1)
            if len(parts) == 2:
                name = parts[1].strip()
                return name if name else None

        if '-' in description:
            parts = re.split(r'(?<!\S)-\s+|\s+-(?!\S)', description, maxsplit=1)
            if len(parts) == 2:
                name = parts[1].strip()
                return name if name else None

        cleaned = description
        for bank in self.BANK_NAMES:
            cleaned = cleaned.replace(bank, '').strip()

        return cleaned if cleaned != description else None

    # ------------------------------------------------------------------
    # Amount / date helpers
    # ------------------------------------------------------------------

    def _parse_date(self, date_value) -> Optional[datetime]:
        """Parse date from various formats."""
        if pd.isna(date_value):
            return None
        if isinstance(date_value, datetime):
            return date_value
        if isinstance(date_value, str):
            for fmt in ('%d/%m/%y', '%d/%m/%Y', '%d.%m.%Y', '%d.%m.%y'):
                try:
                    return datetime.strptime(date_value.strip(), fmt)
                except ValueError:
                    continue
        return None

    def _parse_amount(self, value) -> Optional[float]:
        """Parse amount from string or number."""
        if pd.isna(value):
            return None
        if isinstance(value, (int, float)):
            return float(value)
        if isinstance(value, str):
            cleaned = value.replace(',', '').strip()
            try:
                return float(cleaned)
            except ValueError:
                return None
        return None

    # ------------------------------------------------------------------
    # Classification & filtering
    # ------------------------------------------------------------------

    def _classify_transaction(
        self,
        description: str,
        credit: Optional[float],
        debit: Optional[float],
    ) -> str:
        """Classify transaction type."""
        for keyword in self.FEE_KEYWORDS:
            if keyword in description:
                return 'fee'
        if debit and debit > 0:
            return 'transfer'
        if credit and credit > 0:
            return 'payment'
        return 'other'

    def _filter_transactions(self, transactions: List[Dict]) -> List[Dict]:
        """Filter out non-payment transactions."""
        filtered = []
        for trans in transactions:
            if trans['transaction_type'] == 'fee':
                continue
            if any(kw in trans['description'] for kw in ['סה"כ', 'סיכום', 'סה״כ']):
                continue
            if trans['transaction_type'] == 'transfer':
                continue
            filtered.append(trans)
        return filtered
