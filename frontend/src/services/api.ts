import type { Building, BuildingPaymentSummary, Tenant, PaymentStatusResponse, WhatsAppMessage, Transaction, TenantPaymentHistory, ManualPaymentRequest, StatementReview, Allocation, SetAllocationsRequest, PortfolioTrendMonth, BuildingSummaryStats, ExpenseCategory, Expense, UploadResult, BuildingReportPayload, ReportFormat, RecentUploadsResponse, TransactionPatchPayload, SplitAllocationError, ReviewTransaction, MatchSuggestion, TransactionsListParams, TransactionsListResponse, TransactionCreatePayload, TransactionRow, TenantReportPayload, AppConfig, RiskThresholds, CollectingResponse, SpecialChargeBatch, SpecialChargeCreatePayload, ImportPreviewResponse, ImportApplyResponse, ImportScope, ReminderFilters, ReminderPreviewResponse, SendReminderBody, SendEmailResult, SendSmsResult, WhatsAppBatchResult } from '../types';

export const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000';

export const TOKEN_KEYS = {
  ACCESS: 'access_token',
  REFRESH: 'refresh_token',
} as const;

/** Injects the Bearer token from localStorage into every API request. */
function getAuthHeaders(): Record<string, string> {
  const token = localStorage.getItem(TOKEN_KEYS.ACCESS);
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/**
 * Deduplicated silent refresh: if multiple requests get a 401 simultaneously,
 * only one refresh attempt is made; all waiters share the same promise.
 */
let pendingRefresh: Promise<boolean> | null = null;

async function tryRefreshTokens(): Promise<boolean> {
  const refreshToken = localStorage.getItem(TOKEN_KEYS.REFRESH);
  if (!refreshToken) return false;
  try {
    const res = await fetch(`${API_BASE_URL}/api/v1/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: refreshToken }),
    });
    if (res.ok) {
      const data = await res.json();
      localStorage.setItem(TOKEN_KEYS.ACCESS, data.access_token);
      if (data.refresh_token) localStorage.setItem(TOKEN_KEYS.REFRESH, data.refresh_token);
      return true;
    }
  } catch {}
  return false;
}

// Generic fetch wrapper. Automatically omits Content-Type for FormData (lets browser set boundary).
// _retry=true means this is a second attempt after a successful token refresh — don't retry again.
async function fetchAPI<T>(endpoint: string, options?: RequestInit, _retry = false): Promise<T> {
  const isFormData = options?.body instanceof FormData;
  const response = await fetch(`${API_BASE_URL}${endpoint}`, {
    headers: {
      ...(isFormData ? {} : { 'Content-Type': 'application/json' }),
      ...getAuthHeaders(),
      ...options?.headers,
    },
    ...options,
  });

  if (response.status === 401 && !_retry) {
    // Access token expired — try a silent refresh before giving up
    if (!pendingRefresh) {
      pendingRefresh = tryRefreshTokens().finally(() => { pendingRefresh = null; });
    }
    const refreshed = await pendingRefresh;
    if (refreshed) {
      // Retry once with the new access token
      return fetchAPI<T>(endpoint, options, true);
    }
    // Refresh failed — clear everything and redirect to login
    localStorage.removeItem(TOKEN_KEYS.ACCESS);
    localStorage.removeItem(TOKEN_KEYS.REFRESH);
    window.location.href = '/login';
    throw new Error('Session expired. Please log in again.');
  }

  if (response.status === 401) {
    // Second attempt also 401 — give up
    localStorage.removeItem(TOKEN_KEYS.ACCESS);
    localStorage.removeItem(TOKEN_KEYS.REFRESH);
    window.location.href = '/login';
    throw new Error('Session expired. Please log in again.');
  }

  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: 'Unknown error' }));
    const detail = error?.detail;
    const message =
      typeof detail === 'string'
        ? detail
        : detail && typeof detail === 'object' && typeof (detail as { message?: unknown }).message === 'string'
          ? (detail as { message: string }).message
          : `HTTP ${response.status}`;
    const err = new Error(message) as Error & { status: number; detail: unknown };
    err.status = response.status;
    err.detail = detail;
    throw err;
  }

  if (response.status === 204 || response.status === 205) {
    return undefined as T;
  }

  return response.json();
}

// Buildings API
export const buildingsAPI = {
  list: () => fetchAPI<Building[]>('/api/v1/buildings/'),

  get: (id: string) => fetchAPI<Building>(`/api/v1/buildings/${id}`),

  create: (data: Omit<Building, 'id' | 'created_at' | 'updated_at'>) =>
    fetchAPI<Building>('/api/v1/buildings/', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  update: (id: string, data: Partial<Building>) =>
    fetchAPI<Building>(`/api/v1/buildings/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),

  delete: (id: string) =>
    fetchAPI<void>(`/api/v1/buildings/${id}`, { method: 'DELETE' }),
};

// Payments API
export const paymentsAPI = {
  getStatus: (buildingId: string, month?: number, year?: number) => {
    const params = new URLSearchParams();
    if (month) params.append('month', month.toString());
    if (year) params.append('year', year.toString());
    const query = params.toString() ? `?${params}` : '';
    return fetchAPI<PaymentStatusResponse>(`/api/v1/payments/${buildingId}/status${query}`);
  },

  getUnpaid: (buildingId: string, month?: number, year?: number) => {
    const params = new URLSearchParams();
    if (month) params.append('month', month.toString());
    if (year) params.append('year', year.toString());
    const query = params.toString() ? `?${params}` : '';
    return fetchAPI<{ unpaid_tenants: any[] }>(`/api/v1/payments/${buildingId}/unpaid${query}`);
  },

  getBulkSummary: (month: number, year: number) =>
    fetchAPI<BuildingPaymentSummary[]>(
      `/api/v1/payments/bulk-summary?month=${month}&year=${year}`
    ),

  postManualPayment: (data: ManualPaymentRequest) =>
    fetchAPI<{ transaction_id: string; tenant_id: string; tenant_name: string; amount: number; month: number; year: number; description: string; is_manual: boolean }>(
      '/api/v1/payments/manual',
      { method: 'POST', body: JSON.stringify(data) }
    ),

  getTenantHistory: (tenantId: string) =>
    fetchAPI<TenantPaymentHistory>(`/api/v1/payments/tenant/${tenantId}/history`),

  getTenantDebts: (buildingId: string) =>
    fetchAPI<Record<string, number>>(`/api/v1/payments/${buildingId}/tenant-debts`),

  // Stage 1 additions
  getPortfolioTrend: (months = 13) =>
    fetchAPI<PortfolioTrendMonth[]>(`/api/v1/payments/portfolio-trend?months=${months}`),

  getSummaryStats: (buildingId: string, from: string, to: string, projectionMonths = 0) =>
    fetchAPI<BuildingSummaryStats>(
      `/api/v1/payments/${buildingId}/summary-stats?from=${from}&to=${to}&projection_months=${projectionMonths}`
    ),
};

// Expenses API (Stage 1)
export const expensesAPI = {
  listCategories: (buildingId: string) =>
    fetchAPI<ExpenseCategory[]>(`/api/v1/expenses/${buildingId}/categories/`),

  createCategory: (buildingId: string, data: { name: string; color?: string }) =>
    fetchAPI<ExpenseCategory>(
      `/api/v1/expenses/${buildingId}/categories/`,
      { method: 'POST', body: JSON.stringify(data) }
    ),

  patchCategory: (categoryId: string, data: Partial<{ name: string; color: string }>) =>
    fetchAPI<ExpenseCategory>(
      `/api/v1/expenses/categories/${categoryId}`,
      { method: 'PATCH', body: JSON.stringify(data) }
    ),

  deleteCategory: (categoryId: string) =>
    fetchAPI<void>(`/api/v1/expenses/categories/${categoryId}`, { method: 'DELETE' }),

  list: (buildingId: string, from: string, to: string) =>
    fetchAPI<Expense[]>(`/api/v1/expenses/${buildingId}/?from=${from}&to=${to}`),

  setCategory: (transactionId: string, categoryId: string | null) =>
    fetchAPI<Expense>(
      `/api/v1/expenses/transactions/${transactionId}/category`,
      { method: 'PATCH', body: JSON.stringify({ category_id: categoryId }) }
    ),

  bulkCategorize: (
    buildingId: string,
    payload: {
      transaction_ids: string[];
      category_id: string | null;
      vendor_label?: string;
      notes?: string;
      remember?: boolean;
    },
  ) =>
    fetchAPI<{ updated: number }>(
      `/api/v1/expenses/${buildingId}/bulk-categorize`,
      { method: 'POST', body: JSON.stringify(payload) },
    ),
};

// Statements API
export const statementsAPI = {
  upload: (buildingId: string, file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    return fetchAPI<UploadResult>(`/api/v1/statements/${buildingId}/upload`, { method: 'POST', body: formData });
  },

  listForBuilding: (buildingId: string): Promise<RecentUploadsResponse> =>
    fetchAPI<RecentUploadsResponse>(`/api/v1/statements/${buildingId}/statements`),

  delete: async (statementId: string): Promise<void> => {
    await fetchAPI<void>(`/api/v1/statements/${statementId}`, { method: 'DELETE' });
  },

  patchTransaction: async (txId: string, body: TransactionPatchPayload): Promise<void> => {
    try {
      await fetchAPI<unknown>(`/api/v1/statements/transactions/${txId}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (err) {
      // Re-throw structured 409 so the modal can render the split-error UI.
      if (err && typeof err === 'object' && 'status' in err && (err as { status: number }).status === 409) {
        const detail = (err as { detail?: unknown }).detail;
        if (detail && typeof detail === 'object' && (detail as { code?: string }).code === 'split_allocation_requires_resplit') {
          throw detail as SplitAllocationError;
        }
      }
      throw err;
    }
  },

  getTransactions: (statementId: string) =>
    fetchAPI<{ transactions: Transaction[] }>(`/api/v1/statements/${statementId}/transactions`),

  getReview: (statementId: string) =>
    fetchAPI<StatementReview>(`/api/v1/statements/${statementId}/review`),

  getTransactionReviewForm: (transactionId: string) =>
    fetchAPI<{ tx: ReviewTransaction; all_tenants: MatchSuggestion[]; building_id: string }>(
      `/api/v1/statements/transactions/${transactionId}/review-form`
    ),

  manualMatch: (transactionId: string, tenantId: string, remember = false) =>
    fetchAPI<any>(
      `/api/v1/statements/transactions/${transactionId}/match/${tenantId}${remember ? '?remember=true' : ''}`,
      { method: 'POST' }
    ),

  unmatchTransaction: (transactionId: string) =>
    fetchAPI<{ ok: boolean }>(
      `/api/v1/statements/transactions/${transactionId}/unmatch`,
      { method: 'POST' }
    ),

  ignoreTransaction: (transactionId: string) =>
    fetchAPI<{ ok: boolean }>(
      `/api/v1/statements/transactions/${transactionId}/ignore`,
      { method: 'POST' }
    ),

  deleteTransaction: (transactionId: string) =>
    fetchAPI<void>(
      `/api/v1/statements/transactions/${transactionId}`,
      { method: 'DELETE' }
    ),

  setAllocations: (transactionId: string, payload: SetAllocationsRequest) =>
    fetchAPI<Allocation[]>(
      `/api/v1/statements/transactions/${transactionId}/allocations`,
      { method: 'POST', body: JSON.stringify(payload) }
    ),

  categorizeTransaction: (
    transactionId: string,
    payload: {
      vendor_label: string;
      category_id?: string;       // preferred — per-building category
      category?: string;          // legacy fallback (deprecated)
      notes?: string;             // free-text comment
      remember: boolean;
    }
  ) =>
    fetchAPI<{
      allocation_id: string;
      vendor_label: string;
      category: string | null;
      category_id: string | null;
      category_name: string | null;
      category_color: string | null;
      notes: string | null;
      amount: number;
    }>(
      `/api/v1/transactions/${transactionId}/categorize`,
      { method: 'POST', body: JSON.stringify(payload) }
    ),

  uncategorizeTransaction: (transactionId: string) =>
    fetchAPI<void>(
      `/api/v1/transactions/${transactionId}/categorize`,
      { method: 'DELETE' }
    ),
};

// ── Global Transactions API (cross-building list + manual create) ────────────
//
// CRUD on individual rows still lives on `statementsAPI` (patchTransaction,
// deleteTransaction, manualMatch, unmatchTransaction, ignoreTransaction,
// setAllocations) — this module only owns the global list + create.

function buildTransactionsQuery(params: TransactionsListParams): string {
  const qs = new URLSearchParams();
  const appendList = (key: string, values?: string[]) => {
    if (!values) return;
    for (const v of values) qs.append(key, v);
  };
  appendList('building_id', params.building_id);
  appendList('type', params.type);
  appendList('match_status', params.match_status);
  appendList('category_id', params.category_id);
  if (params.direction) qs.set('direction', params.direction);
  if (params.tenant_id) qs.set('tenant_id', params.tenant_id);
  if (params.source) qs.set('source', params.source);
  if (params.date_from) qs.set('date_from', params.date_from);
  if (params.date_to) qs.set('date_to', params.date_to);
  if (params.amount_min !== undefined) qs.set('amount_min', String(params.amount_min));
  if (params.amount_max !== undefined) qs.set('amount_max', String(params.amount_max));
  if (params.q) qs.set('q', params.q);
  if (params.sort) qs.set('sort', params.sort);
  if (params.page) qs.set('page', String(params.page));
  if (params.page_size) qs.set('page_size', String(params.page_size));
  const s = qs.toString();
  return s ? `?${s}` : '';
}

export const transactionsAPI = {
  list: (params: TransactionsListParams = {}) =>
    fetchAPI<TransactionsListResponse>(
      `/api/v1/transactions/${buildTransactionsQuery(params)}`
    ),

  create: (payload: TransactionCreatePayload) =>
    fetchAPI<TransactionRow>('/api/v1/transactions/', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
};

// Messages API
export const messagesAPI = {
  // ─── Legacy single-tenant flow (still used by the per-row "📱 Send" button) ─
  generateReminders: (buildingId: string, onlyUnpaid = true) => {
    const params = new URLSearchParams({ only_unpaid: onlyUnpaid.toString() });
    return fetchAPI<{ messages: WhatsAppMessage[] }>(
      `/api/v1/messages/${buildingId}/generate-reminders?${params}`,
      { method: 'POST' }
    );
  },

  markSent: (messageId: string) =>
    fetchAPI<void>(`/api/v1/messages/message/${messageId}/mark-sent`, { method: 'POST' }),

  // ─── New bulk-send flow (SendRemindersModal) ──────────────────────────────

  /** Resolve filters → recipient list + availability counts. No DB writes. */
  previewReminders: (filters: ReminderFilters) =>
    fetchAPI<ReminderPreviewResponse>('/api/v1/messages/preview', {
      method: 'POST',
      body: JSON.stringify(filters),
    }),

  sendEmail: (body: SendReminderBody) =>
    fetchAPI<SendEmailResult>('/api/v1/messages/send-email', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  sendSms: (body: SendReminderBody) =>
    fetchAPI<SendSmsResult>('/api/v1/messages/send-sms', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  /** Returns per-tenant wa.me links + creates PENDING messages.
   *  After user clicks each link in WhatsApp Web, frontend calls markSent(). */
  whatsappBatch: (body: SendReminderBody) =>
    fetchAPI<WhatsAppBatchResult>('/api/v1/messages/whatsapp-batch', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
};

// Tenants API
export const tenantsAPI = {
  import: (buildingId: string, file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    return fetchAPI<any>(`/api/v1/tenants/${buildingId}/import`, { method: 'POST', body: formData });
  },

  list: (buildingId?: string) => {
    const query = buildingId ? `?building_id=${buildingId}` : '';
    return fetchAPI<Tenant[]>(`/api/v1/tenants/${query}`);
  },

  listArchived: (buildingId?: string) => {
    const params = new URLSearchParams({ archived: 'true' });
    if (buildingId) params.set('building_id', buildingId);
    return fetchAPI<Tenant[]>(`/api/v1/tenants/?${params.toString()}`);
  },

  restore: (tenantId: string) =>
    fetchAPI<{ ok: boolean; tenant_id: string }>(
      `/api/v1/tenants/${tenantId}/restore`,
      { method: 'POST' }
    ),

  create: (data: {
    apartment_id: string;
    building_id: string;
    name: string;
    full_name?: string;
    ownership_type?: string;
    phone?: string;
    email?: string;
    language?: string;
    standing_order_start_date?: string | null;
    standing_order_end_date?: string | null;
    standing_order_amount?: number | null;
    is_active?: boolean;
    move_in_date?: string;
  }) =>
    fetchAPI<Tenant>('/api/v1/tenants/', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  update: (tenantId: string, data: Partial<Tenant>) =>
    fetchAPI<Tenant>(`/api/v1/tenants/${tenantId}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),

  delete: (tenantId: string) =>
    fetchAPI<void>(`/api/v1/tenants/${tenantId}`, { method: 'DELETE' }),

  resolveApartment: (buildingId: string, aptNumber: number, floor = 0) =>
    fetchAPI<{ apartment_id: string; apartment_number: number; floor: number }>(
      `/api/v1/tenants/${buildingId}/apartments/resolve`,
      {
        method: 'POST',
        body: JSON.stringify({ apt_number: aptNumber, floor }),
      }
    ),
};

// Apartments API
export interface ApartmentPatchBody {
  expected_payment?: number | null;
  fallback_owner_tenant_id?: string | null;
}
export interface ApartmentPatchResponse {
  apartment_id: string;
  expected_payment: number | null;
  fallback_owner_tenant_id: string | null;
}
export const apartmentsAPI = {
  patch: (apartmentId: string, data: ApartmentPatchBody) =>
    fetchAPI<ApartmentPatchResponse>(
      `/api/v1/tenants/apartments/${apartmentId}`,
      {
        method: 'PATCH',
        body: JSON.stringify(data),
      }
    ),
};

// Reports API
export const reportsAPI = {
  getPayload: (buildingId: string, from: string, to: string) =>
    fetchAPI<BuildingReportPayload>(`/api/v1/buildings/${buildingId}/report?from=${from}&to=${to}`),

  async download(
    buildingId: string,
    from: string,
    to: string,
    format: ReportFormat,
  ): Promise<{ blob: Blob; filename: string }> {
    const token = localStorage.getItem(TOKEN_KEYS.ACCESS);
    const url = `${API_BASE_URL}/api/v1/buildings/${buildingId}/report.${format}?from=${from}&to=${to}`;
    const res = await fetch(url, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) throw new Error(`Report download failed: ${res.status}`);
    const blob = await res.blob();
    const cd = res.headers.get('content-disposition') ?? '';
    const m = cd.match(/filename\*=UTF-8''([^;]+)/i);
    const filename = m ? decodeURIComponent(m[1]) : `report.${format}`;
    return { blob, filename };
  },

  getTenantPayload: (tenantId: string, from: string, to: string) =>
    fetchAPI<TenantReportPayload>(`/api/v1/tenants/${tenantId}/report?from=${from}&to=${to}`),

  async downloadTenant(
    tenantId: string,
    from: string,
    to: string,
    format: ReportFormat,
  ): Promise<{ blob: Blob; filename: string }> {
    const token = localStorage.getItem(TOKEN_KEYS.ACCESS);
    const url = `${API_BASE_URL}/api/v1/tenants/${tenantId}/report.${format}?from=${from}&to=${to}`;
    const res = await fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
    if (!res.ok) throw new Error(`Tenant report download failed: ${res.status}`);
    const blob = await res.blob();
    const cd = res.headers.get('content-disposition') ?? '';
    const m = cd.match(/filename\*=UTF-8''([^;]+)/i);
    const filename = m ? decodeURIComponent(m[1]) : `tenant-report.${format}`;
    return { blob, filename };
  },

  async downloadTenantBulk(
    tenantIds: string[],
    from: string,
    to: string,
    format: ReportFormat,
  ): Promise<{ blob: Blob; filename: string }> {
    const token = localStorage.getItem(TOKEN_KEYS.ACCESS);
    const url = `${API_BASE_URL}/api/v1/tenants/bulk-report?from=${from}&to=${to}&format=${format}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ tenant_ids: tenantIds }),
    });
    if (!res.ok) throw new Error(`Bulk report download failed: ${res.status}`);
    const blob = await res.blob();
    const cd = res.headers.get('content-disposition') ?? '';
    const m = cd.match(/filename\*=UTF-8''([^;]+)/i);
    const filename = m ? decodeURIComponent(m[1]) : `reports.zip`;
    return { blob, filename };
  },
};

// System-wide settings (app_config K-V store)
export const settingsAPI = {
  get: () => fetchAPI<AppConfig>('/api/v1/settings/'),

  putRiskThresholds: (body: RiskThresholds) =>
    fetchAPI<RiskThresholds>('/api/v1/settings/risk_thresholds', {
      method: 'PUT',
      body: JSON.stringify(body),
    }),
};

export const collectingAPI = {
  /** Per-apartment collecting view backed by the new debt tables.
   * Returns one row per apartment in the building, sorted by apt number,
   * each with the apartment's tenants list (active flagged as primary_payer). */
  get: (buildingId: string) =>
    fetchAPI<CollectingResponse>(`/api/v1/collecting/${buildingId}/`),
};

export const specialChargesAPI = {
  create: (payload: SpecialChargeCreatePayload) =>
    fetchAPI<SpecialChargeBatch>('/api/v1/special-charges/', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  list: (buildingId: string) =>
    fetchAPI<SpecialChargeBatch[]>(`/api/v1/special-charges/?building_id=${buildingId}`),

  get: (batchId: string) =>
    fetchAPI<SpecialChargeBatch>(`/api/v1/special-charges/${batchId}/`),
};

export const monthlyAmountsImportAPI = {
  /** Preview: parse the xlsx and report what the import would do. No DB writes. */
  preview: (buildingId: string, file: File) => {
    const fd = new FormData();
    fd.append('file', file);
    fd.append('building_id', buildingId);
    fd.append('dry_run', 'true');
    fd.append('scope', 'future_only');
    return fetchAPI<ImportPreviewResponse>('/api/v1/imports/monthly-amounts/', {
      method: 'POST',
      body: fd,
    });
  },

  /** Apply: same upload, dry_run=false, with chosen scope. Writes to DB. */
  apply: (buildingId: string, file: File, scope: ImportScope) => {
    const fd = new FormData();
    fd.append('file', file);
    fd.append('building_id', buildingId);
    fd.append('dry_run', 'false');
    fd.append('scope', scope);
    return fetchAPI<ImportApplyResponse>('/api/v1/imports/monthly-amounts/', {
      method: 'POST',
      body: fd,
    });
  },
};
