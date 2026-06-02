"""
Fuzzy Matching Engine for Hebrew Names
Matches bank transaction payer names to tenant names using multiple strategies.
"""

from typing import List, Dict, Optional, Tuple
from rapidfuzz import fuzz
import re


class NameMatchingEngine:
    """
    Fuzzy matching engine for Hebrew names.
    Handles name reversals, abbreviations, and Hebrew-specific quirks.
    """

    def __init__(self, confidence_threshold: float = 0.7):
        """
        Args:
            confidence_threshold: Minimum confidence score (0-1) for a match
        """
        self.confidence_threshold = confidence_threshold

    def match_transaction_to_tenants(
        self,
        payer_name: str,
        tenants: List[Dict],
        expected_amount: Optional[float] = None,
        actual_amount: Optional[float] = None
    ) -> Tuple[Optional[str], float, str]:
        """
        Match a payer name from bank to a tenant.

        Args:
            payer_name: Name from bank transaction
            tenants: List of tenant dicts with 'id', 'name', 'full_name'
            expected_amount: Expected payment amount
            actual_amount: Actual payment amount

        Returns:
            Tuple of (tenant_id, confidence_score, match_method)
        """
        if not payer_name or not tenants:
            return None, 0.0, 'none'

        # Normalize the payer name
        normalized_payer = self._normalize_name(payer_name)

        best_match = None
        best_score = 0.0
        best_method = 'none'

        for tenant in tenants:
            tenant_id = str(tenant['id'])
            tenant_name = tenant.get('name', '')
            tenant_full_name = tenant.get('full_name', tenant_name)

            # Get name variants (including parenthesized aliases)
            variants = self._get_name_variants(tenant_name, tenant_full_name)

            # Try multiple matching strategies against all variants
            strategies = [
                ('exact', self._exact_match),
                ('reversed_name', self._reversed_name_match),
                ('fuzzy', self._fuzzy_match),
                ('token_based', self._token_based_match),
                ('family_name', self._family_name_match),
            ]

            for method, matcher in strategies:
                # Match against primary names
                score = matcher(normalized_payer, tenant_name, tenant_full_name)
                if score > best_score:
                    best_score = score
                    best_match = tenant_id
                    best_method = method

                # Match against alias variants
                for variant in variants:
                    score = matcher(normalized_payer, variant, variant)
                    if score > best_score:
                        best_score = score
                        best_match = tenant_id
                        best_method = method

        # Try amount matching if applicable
        if expected_amount and actual_amount:
            if abs(expected_amount - actual_amount) < 1.0:  # Within 1 shekel
                # Boost confidence if amounts match
                best_score = min(best_score + 0.2, 1.0)
                if best_method == 'none':
                    best_method = 'amount'

        # Only return match if above threshold
        if best_score >= self.confidence_threshold:
            return best_match, best_score, best_method

        return None, best_score, best_method

    def _normalize_name(self, name: str) -> str:
        """Normalize Hebrew name for comparison"""
        if not name:
            return ''

        # Remove extra whitespace
        name = ' '.join(name.split())

        # Convert to lowercase (works for Hebrew too)
        name = name.lower()

        # Remove parenthesized content (e.g., "אלה (פליקס) רויטמן" → "אלה רויטמן")
        name = re.sub(r'\([^)]*\)', '', name)

        # Remove common punctuation including backtick/geresh
        name = re.sub(r'[.,\'"״״`׳\']', '', name)

        # Normalize Hebrew final letters (if needed)
        # ך -> כ, ם -> מ, ן -> נ, ף -> פ, ץ -> צ
        final_to_normal = {
            'ך': 'כ',
            'ם': 'מ',
            'ן': 'נ',
            'ף': 'פ',
            'ץ': 'צ'
        }
        for final, normal in final_to_normal.items():
            name = name.replace(final, normal)

        # Strip Hebrew "ו" (and) prefix from tokens
        tokens = name.split()
        cleaned_tokens = []
        for t in tokens:
            if len(t) > 2 and t.startswith('ו'):
                cleaned_tokens.append(t[1:])
            else:
                cleaned_tokens.append(t)
        name = ' '.join(cleaned_tokens)

        return name.strip()

    def _exact_match(
        self,
        payer_name: str,
        tenant_name: str,
        tenant_full_name: str
    ) -> float:
        """Exact string match"""
        normalized_tenant = self._normalize_name(tenant_name)
        normalized_full = self._normalize_name(tenant_full_name)

        if payer_name == normalized_tenant or payer_name == normalized_full:
            return 1.0

        return 0.0

    def _reversed_name_match(
        self,
        payer_name: str,
        tenant_name: str,
        tenant_full_name: str
    ) -> float:
        """
        Match with name parts reversed.
        Example: "מן גיא" matches "גיא מן"
        Also handles truncated names: "רבינוביץ רע" matches "רעיסה רבינוביץ"
        """
        payer_parts = payer_name.split()
        tenant_str = self._normalize_name(tenant_name)
        full_str = self._normalize_name(tenant_full_name)
        tenant_parts = tenant_str.split()
        full_parts = full_str.split()

        # Try reversing payer name
        if len(payer_parts) >= 2:
            reversed_payer = ' '.join(reversed(payer_parts))
            reversed_parts = list(reversed(payer_parts))

            # Check exact reversed match
            if reversed_payer == tenant_str or reversed_payer == full_str:
                return 0.95

            # Check startswith (handles abbreviated names)
            if reversed_payer.startswith(tenant_str) or tenant_str.startswith(reversed_payer):
                return 0.85

            if reversed_payer.startswith(full_str) or full_str.startswith(reversed_payer):
                return 0.85

            # Token prefix match for reversed names (handles truncated names)
            # e.g., reversed ["רע", "רבינוביץ"] vs tenant ["רעיסה", "רבינוביץ"]
            for target_parts in [tenant_parts, full_parts]:
                if len(reversed_parts) == len(target_parts):
                    all_match = True
                    prefix_used = False
                    for rp, tp in zip(reversed_parts, target_parts):
                        if rp == tp:
                            continue
                        elif len(rp) >= 2 and tp.startswith(rp):
                            prefix_used = True
                        elif len(tp) >= 2 and rp.startswith(tp):
                            prefix_used = True
                        else:
                            all_match = False
                            break
                    if all_match and prefix_used:
                        return 0.80

        # Try reversing tenant name
        if len(tenant_parts) >= 2:
            reversed_tenant = ' '.join(reversed(tenant_parts))
            if payer_name == reversed_tenant:
                return 0.95

            # Token prefix match with reversed tenant
            reversed_tenant_parts = list(reversed(tenant_parts))
            if len(payer_parts) == len(reversed_tenant_parts):
                all_match = True
                prefix_used = False
                for pp, tp in zip(payer_parts, reversed_tenant_parts):
                    if pp == tp:
                        continue
                    elif len(pp) >= 2 and tp.startswith(pp):
                        prefix_used = True
                    elif len(tp) >= 2 and pp.startswith(tp):
                        prefix_used = True
                    else:
                        all_match = False
                        break
                if all_match and prefix_used:
                    return 0.80

        # Same for full name
        if len(full_parts) >= 2:
            reversed_full = ' '.join(reversed(full_parts))
            if payer_name == reversed_full:
                return 0.95

        return 0.0

    def _fuzzy_match(
        self,
        payer_name: str,
        tenant_name: str,
        tenant_full_name: str
    ) -> float:
        """Fuzzy string matching using rapidfuzz"""
        # Try matching against both tenant name and full name
        score_name = fuzz.ratio(payer_name, self._normalize_name(tenant_name)) / 100.0
        score_full = fuzz.ratio(payer_name, self._normalize_name(tenant_full_name)) / 100.0

        # Use the better score
        best_score = max(score_name, score_full)

        # Also try partial ratio (substring matching)
        partial_name = fuzz.partial_ratio(payer_name, self._normalize_name(tenant_name)) / 100.0
        partial_full = fuzz.partial_ratio(payer_name, self._normalize_name(tenant_full_name)) / 100.0

        partial_score = max(partial_name, partial_full)

        # Weight full match higher than partial
        final_score = (best_score * 0.7 + partial_score * 0.3)

        return final_score

    def _token_based_match(
        self,
        payer_name: str,
        tenant_name: str,
        tenant_full_name: str
    ) -> float:
        """
        Token-based matching (word-by-word).
        Uses containment score (what fraction of tenant tokens are found in payer)
        plus token prefix matching for truncated names.
        """
        payer_tokens = payer_name.split()
        tenant_tokens = self._normalize_name(tenant_name).split()
        full_tokens = self._normalize_name(tenant_full_name).split()

        def token_match(payer_tok: str, tenant_tok: str) -> bool:
            """Check if two tokens match, including prefix matching (min 2 chars)"""
            if payer_tok == tenant_tok:
                return True
            # Prefix: payer is abbreviated form of tenant (e.g., "רע" → "רעיסה")
            if len(payer_tok) >= 2 and tenant_tok.startswith(payer_tok):
                return True
            # Prefix: tenant is abbreviated form of payer
            if len(tenant_tok) >= 2 and payer_tok.startswith(tenant_tok):
                return True
            return False

        def containment_score(payer_toks: list, tenant_toks: list) -> float:
            """
            What fraction of tenant tokens are matched by payer tokens?
            This is better than Jaccard because payer often has extra tokens
            (e.g., "רויטמן פליקס אל" vs tenant "פליקס רויטמן")
            """
            if not tenant_toks:
                return 0.0

            matched = 0
            used_payer = set()  # Track which payer tokens are used

            for tt in tenant_toks:
                for i, pt in enumerate(payer_toks):
                    if i not in used_payer and token_match(pt, tt):
                        matched += 1
                        used_payer.add(i)
                        break

            return matched / len(tenant_toks)

        # Forward: what fraction of tenant tokens are matched by payer?
        fwd_tenant = containment_score(payer_tokens, tenant_tokens)
        fwd_full = containment_score(payer_tokens, full_tokens)

        # Reverse: what fraction of payer tokens are found in tenant?
        # Catches cases like payer "פרידמן מרים" → tenant "נחום ומרים פרידמן"
        # where all payer tokens exist in tenant (2/2 = 1.0)
        # Only do this when payer has 2+ tokens to avoid false positives
        rev_tenant = containment_score(tenant_tokens, payer_tokens) if len(payer_tokens) >= 2 else 0.0
        rev_full = containment_score(full_tokens, payer_tokens) if len(payer_tokens) >= 2 else 0.0

        # Also try with reversed payer tokens
        rev_payer_tokens = list(reversed(payer_tokens))
        fwd_tenant_rev = containment_score(rev_payer_tokens, tenant_tokens)
        fwd_full_rev = containment_score(rev_payer_tokens, full_tokens)
        rev_tenant_rev = containment_score(tenant_tokens, rev_payer_tokens) if len(rev_payer_tokens) >= 2 else 0.0
        rev_full_rev = containment_score(full_tokens, rev_payer_tokens) if len(rev_payer_tokens) >= 2 else 0.0

        best_score = max(
            fwd_tenant, fwd_full,
            rev_tenant, rev_full,
            fwd_tenant_rev, fwd_full_rev,
            rev_tenant_rev, rev_full_rev
        )

        # Scale: 100% containment → 0.90, 50% → 0.45
        # This ensures high containment gets above threshold
        best_score = best_score * 0.90

        return best_score

    def _family_name_match(
        self,
        payer_name: str,
        tenant_name: str,
        tenant_full_name: str
    ) -> float:
        """
        Match based on shared family name (last name).
        Handles family member payments: "גילון נורית" paying for tenant "גילון גילון".

        In Israeli bank statements, payer format is typically "LAST FIRST" (last name first).
        Score 0.72 for exact last-name match (just above threshold to allow it through,
        but low enough that better strategies take priority).
        """
        payer_tokens = payer_name.split()
        tenant_tokens = self._normalize_name(tenant_name).split()
        full_tokens = self._normalize_name(tenant_full_name).split()

        if not payer_tokens:
            return 0.0

        # In Hebrew bank statements, the first token is typically the family name
        payer_family = payer_tokens[0]

        # Check if payer family name matches any tenant token
        for target_tokens in [tenant_tokens, full_tokens]:
            if not target_tokens:
                continue
            for tt in target_tokens:
                if payer_family == tt and len(payer_family) >= 3:
                    # Family name match - return moderate score
                    return 0.72

                # Also check prefix match for truncated family names
                if len(payer_family) >= 3 and len(tt) >= 3:
                    if tt.startswith(payer_family) or payer_family.startswith(tt):
                        return 0.71

        return 0.0

    def _get_name_variants(
        self,
        tenant_name: str,
        tenant_full_name: str
    ) -> List[str]:
        """
        Extract name variants from tenant name, including parenthesized aliases.
        Example: "אלה (פליקס) רויטמן" → ["פליקס רויטמן"]
        """
        variants = []

        for name in [tenant_name, tenant_full_name]:
            if not name:
                continue

            # Extract parenthesized aliases
            match = re.search(r'\(([^)]+)\)', name)
            if match:
                alias = match.group(1).strip()
                # Build variant: alias + last name (non-parenthesized parts)
                other_parts = re.sub(r'\([^)]*\)', '', name).split()
                if other_parts:
                    # Try alias + last name (assuming last part is family name)
                    last_name = other_parts[-1].strip()
                    if last_name:
                        variants.append('{} {}'.format(alias, last_name))
                    # Also try last name + alias (reversed)
                    first_name = other_parts[0].strip()
                    if first_name and first_name != last_name:
                        variants.append('{} {}'.format(alias, first_name))

        return variants

    def find_unmatched_transactions(
        self,
        transactions: List[Dict],
        matched_tenant_ids: List[str]
    ) -> List[Dict]:
        """Return transactions that haven't been matched"""
        return [
            t for t in transactions
            if t.get('matched_tenant_id') not in matched_tenant_ids
        ]

    def suggest_matches(
        self,
        payer_name: str,
        tenants: List[Dict],
        top_n: int = 3
    ) -> List[Tuple[str, float, str]]:
        """
        Get top N suggested matches for manual review.

        Returns:
            List of (tenant_id, confidence, tenant_name) tuples
        """
        suggestions = []

        for tenant in tenants:
            tenant_id = str(tenant['id'])
            tenant_name = tenant.get('name', '')

            # Get best match score
            _, score, method = self.match_transaction_to_tenants(
                payer_name,
                [tenant],
                None,
                None
            )

            if score > 0:
                suggestions.append((tenant_id, score, tenant_name, method))

        # Sort by confidence (descending)
        suggestions.sort(key=lambda x: x[1], reverse=True)

        return suggestions[:top_n]
