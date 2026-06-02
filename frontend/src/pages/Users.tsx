import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../context/AuthContext';
import Button from '../components/ui/Button';
import Modal from '../components/ui/Modal';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000';

interface AppUser {
  id: string;
  email: string;
  full_name: string;
  role: string;
  status: string;
  building_id?: string | null;
  created_at?: string;
}

interface Building {
  id: string;
  name: string;
}

interface InviteForm {
  email: string;
  full_name: string;
  role: string;
  building_id: string;
}

const roleLabels: Record<string, string> = {
  manager: 'מנהל',
  worker: 'עובד',
  viewer: 'צופה',
  tenant: 'דייר',
};

const statusLabels: Record<string, string> = {
  active: 'פעיל',
  pending: 'ממתין לאישור',
  invited: 'הוזמן',
};

const roleBadgeColors: Record<string, string> = {
  manager: 'bg-purple-100 text-purple-700',
  worker: 'bg-primary-100 text-primary-700',
  viewer: 'bg-ink-100 text-ink-700',
  tenant: 'bg-accent-100 text-accent-700',
};

const statusBadgeColors: Record<string, string> = {
  active: 'bg-accent-100 text-accent-700',
  pending: 'bg-warn-50 text-warn-600',
  invited: 'bg-primary-100 text-primary-700',
};

const Users: React.FC = () => {
  const { user: currentUser } = useAuth();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<'all' | 'pending'>('all');
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [inviteForm, setInviteForm] = useState<InviteForm>({
    email: '',
    full_name: '',
    role: 'viewer',
    building_id: '',
  });
  const [inviteResult, setInviteResult] = useState('');
  const [inviteError, setInviteError] = useState('');
  const [copied, setCopied] = useState(false);
  const [editingUser, setEditingUser] = useState<AppUser | null>(null);
  const [editForm, setEditForm] = useState<{ full_name: string; role: string; building_id: string }>({ full_name: '', role: 'viewer', building_id: '' });
  const [editError, setEditError] = useState('');

  const authHeaders = {
    'Authorization': `Bearer ${localStorage.getItem('access_token') || ''}`,
    'Content-Type': 'application/json',
  };

  const { data: users = [], isLoading } = useQuery<AppUser[]>({
    queryKey: ['users'],
    queryFn: async () => {
      const res = await fetch(`${API_BASE_URL}/api/v1/users/`, { headers: authHeaders });
      if (!res.ok) throw new Error('Failed to load users');
      return res.json();
    },
  });

  const { data: buildings = [] } = useQuery<Building[]>({
    queryKey: ['buildings-simple'],
    queryFn: async () => {
      const res = await fetch(`${API_BASE_URL}/api/v1/buildings/`, { headers: authHeaders });
      if (!res.ok) return [];
      return res.json();
    },
  });

  const approveMutation = useMutation({
    mutationFn: async (userId: string) => {
      const res = await fetch(`${API_BASE_URL}/api/v1/users/${userId}/approve`, {
        method: 'POST',
        headers: authHeaders,
      });
      if (!res.ok) throw new Error('Failed to approve');
      return res.json();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['users'] }),
  });

  const updateMutation = useMutation({
    mutationFn: async (vars: { id: string; body: { full_name?: string; role?: string; building_id?: string | null } }) => {
      const res = await fetch(`${API_BASE_URL}/api/v1/users/${vars.id}`, {
        method: 'PATCH',
        headers: authHeaders,
        body: JSON.stringify(vars.body),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || 'Failed to update');
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
      setEditingUser(null);
    },
    onError: (err: Error) => setEditError(err.message),
  });

  const openEdit = (u: AppUser) => {
    setEditError('');
    setEditingUser(u);
    setEditForm({
      full_name: u.full_name,
      role: u.role,
      building_id: u.building_id || '',
    });
  };

  const submitEdit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingUser) return;
    setEditError('');
    const body: { full_name?: string; role?: string; building_id?: string | null } = {};
    if (editForm.full_name !== editingUser.full_name) body.full_name = editForm.full_name;
    if (editForm.role !== editingUser.role) body.role = editForm.role;
    const newBuildingId = editForm.role === 'tenant' ? (editForm.building_id || null) : null;
    const oldBuildingId = editingUser.building_id || null;
    if (newBuildingId !== oldBuildingId) body.building_id = newBuildingId;
    if (Object.keys(body).length === 0) {
      setEditingUser(null);
      return;
    }
    updateMutation.mutate({ id: editingUser.id, body });
  };

  const deleteMutation = useMutation({
    mutationFn: async (userId: string) => {
      const res = await fetch(`${API_BASE_URL}/api/v1/users/${userId}`, {
        method: 'DELETE',
        headers: authHeaders,
      });
      if (!res.ok) throw new Error('Failed to delete');
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['users'] }),
  });

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    setInviteError('');
    setInviteResult('');
    try {
      const res = await fetch(`${API_BASE_URL}/api/v1/users/invite`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
          email: inviteForm.email,
          full_name: inviteForm.full_name,
          role: inviteForm.role,
          building_id: inviteForm.building_id || undefined,
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || 'Error');
      }
      const data = await res.json();
      setInviteResult(data.invite_url);
      queryClient.invalidateQueries({ queryKey: ['users'] });
      setInviteForm({ email: '', full_name: '', role: 'viewer', building_id: '' });
    } catch (err: unknown) {
      setInviteError(err instanceof Error ? err.message : 'שגיאה');
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const closeInviteModal = () => {
    setShowInviteModal(false);
    setInviteResult('');
    setInviteError('');
    setInviteForm({ email: '', full_name: '', role: 'viewer', building_id: '' });
  };

  const pendingUsers = users.filter(u => u.status === 'pending');
  const displayUsers = activeTab === 'pending' ? pendingUsers : users;

  return (
    <div className="p-6 max-w-6xl mx-auto" dir="rtl">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-ink-900">ניהול משתמשים</h1>
          <p className="text-ink-500 text-sm mt-0.5">הוסף ונהל את משתמשי המערכת</p>
        </div>
        <Button onClick={() => setShowInviteModal(true)}>
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
          </svg>
          הזמן משתמש
        </Button>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 mb-4">
        {(['all', 'pending'] as const).map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`relative px-4 py-2 rounded-lg text-sm font-medium transition ${
              activeTab === tab
                ? 'bg-primary-600 text-white'
                : 'bg-ink-100 text-ink-700 hover:bg-ink-200'
            }`}
          >
            {tab === 'all'
              ? `כל המשתמשים (${users.length})`
              : `ממתינים לאישור`}
            {tab === 'pending' && pendingUsers.length > 0 && (
              <span className="mr-1.5 inline-flex items-center justify-center bg-danger-500 text-white text-xs rounded-full w-4 h-4 font-bold">
                {pendingUsers.length}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Users Table */}
      <div className="bg-white rounded-xl shadow-sm ring-1 ring-ink-200 overflow-hidden">
        {isLoading ? (
          <div className="p-8 text-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600 mx-auto" />
          </div>
        ) : displayUsers.length === 0 ? (
          <div className="p-12 text-center text-ink-500">
            <svg className="w-10 h-10 mx-auto mb-3 text-ink-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            <p>{activeTab === 'pending' ? 'אין משתמשים הממתינים לאישור' : 'אין משתמשים במערכת'}</p>
          </div>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="bg-ink-50 border-b border-ink-100">
                <th className="px-5 py-3 text-right text-xs font-semibold text-ink-500 uppercase tracking-wider">שם</th>
                <th className="px-5 py-3 text-right text-xs font-semibold text-ink-500 uppercase tracking-wider">אימייל</th>
                <th className="px-5 py-3 text-right text-xs font-semibold text-ink-500 uppercase tracking-wider">תפקיד</th>
                <th className="px-5 py-3 text-right text-xs font-semibold text-ink-500 uppercase tracking-wider">סטטוס</th>
                <th className="px-5 py-3 text-right text-xs font-semibold text-ink-500 uppercase tracking-wider">פעולות</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-50">
              {displayUsers.map(u => (
                <tr key={u.id} className={`hover:bg-ink-50 transition ${u.id === currentUser?.id ? 'bg-primary-50/30' : ''}`}>
                  <td className="px-5 py-3.5 font-medium text-ink-900">
                    {u.full_name}
                    {u.id === currentUser?.id && (
                      <span className="mr-2 text-xs text-ink-500">(אתה)</span>
                    )}
                  </td>
                  <td className="px-5 py-3.5 text-ink-500 text-sm" dir="ltr">{u.email}</td>
                  <td className="px-5 py-3.5">
                    <span className={`px-2.5 py-1 rounded-full text-xs font-medium ${roleBadgeColors[u.role] ?? 'bg-ink-100 text-ink-700'}`}>
                      {roleLabels[u.role] ?? u.role}
                    </span>
                  </td>
                  <td className="px-5 py-3.5">
                    <span className={`px-2.5 py-1 rounded-full text-xs font-medium ${statusBadgeColors[u.status] ?? 'bg-ink-100 text-ink-700'}`}>
                      {statusLabels[u.status] ?? u.status}
                    </span>
                  </td>
                  <td className="px-5 py-3.5">
                    <div className="flex items-center gap-2">
                      {u.status === 'pending' && (
                        <button
                          onClick={() => approveMutation.mutate(u.id)}
                          disabled={approveMutation.isPending}
                          className="text-xs bg-accent-100 text-accent-700 hover:bg-accent-200 px-3 py-1.5 rounded-lg transition font-medium"
                        >
                          אשר
                        </button>
                      )}
                      <button
                        onClick={() => openEdit(u)}
                        className="text-xs bg-primary-50 text-primary-700 hover:bg-primary-100 px-3 py-1.5 rounded-lg transition font-medium"
                      >
                        ערוך
                      </button>
                      {u.id !== currentUser?.id && (
                        <button
                          onClick={() => {
                            if (window.confirm(`האם למחוק את המשתמש "${u.full_name}"?`)) {
                              deleteMutation.mutate(u.id);
                            }
                          }}
                          disabled={deleteMutation.isPending}
                          className="text-xs bg-danger-50 text-danger-600 hover:bg-danger-50 px-3 py-1.5 rounded-lg transition font-medium"
                        >
                          מחק
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Edit User Modal */}
      {editingUser && (
        <Modal open onClose={() => setEditingUser(null)} srTitle="עריכת משתמש" size="md" hideClose className="p-6">
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-lg font-bold text-ink-900">עריכת משתמש</h2>
              <button
                onClick={() => setEditingUser(null)}
                aria-label="סגור חלון"
                className="text-ink-500 hover:text-ink-700 text-2xl leading-none w-8 h-8 flex items-center justify-center rounded-lg hover:bg-ink-100"
              >
                ×
              </button>
            </div>
            <form onSubmit={submitEdit} className="space-y-4">
              <div>
                <label htmlFor="usr-edit-name" className="block text-[13px] font-medium text-ink-700 mb-1.5">שם מלא</label>
                <input
                  id="usr-edit-name"
                  type="text"
                  required
                  value={editForm.full_name}
                  onChange={e => setEditForm(p => ({ ...p, full_name: e.target.value }))}
                  className="w-full px-4 py-2.5 rounded-lg ring-1 ring-ink-200 focus:outline-none focus:ring-2 focus:ring-primary-500 text-right"
                />
              </div>
              <div>
                <label htmlFor="usr-edit-email" className="block text-[13px] font-medium text-ink-700 mb-1.5">אימייל</label>
                <input
                  id="usr-edit-email"
                  type="email"
                  disabled
                  value={editingUser.email}
                  className="w-full px-4 py-2.5 border border-ink-200 rounded-xl bg-ink-50 text-ink-500"
                  dir="ltr"
                />
              </div>
              <div>
                <label htmlFor="usr-edit-role" className="block text-[13px] font-medium text-ink-700 mb-1.5">תפקיד</label>
                <select
                  id="usr-edit-role"
                  value={editForm.role}
                  onChange={e => setEditForm(p => ({ ...p, role: e.target.value, building_id: e.target.value === 'tenant' ? p.building_id : '' }))}
                  className="w-full px-4 py-2.5 rounded-lg ring-1 ring-ink-200 focus:outline-none focus:ring-2 focus:ring-primary-500"
                >
                  <option value="manager">מנהל – גישה מלאה</option>
                  <option value="worker">עובד – יכול לצפות ולערוך</option>
                  <option value="viewer">צופה – יכול לצפות בלבד</option>
                  <option value="tenant">דייר – רואה בניין שלו בלבד</option>
                </select>
              </div>
              {editForm.role === 'tenant' && (
                <div>
                  <label htmlFor="usr-edit-building" className="block text-[13px] font-medium text-ink-700 mb-1.5">בניין (לדיירים)</label>
                  <select
                    id="usr-edit-building"
                    value={editForm.building_id}
                    onChange={e => setEditForm(p => ({ ...p, building_id: e.target.value }))}
                    className="w-full px-4 py-2.5 rounded-lg ring-1 ring-ink-200 focus:outline-none focus:ring-2 focus:ring-primary-500"
                  >
                    <option value="">-- בחר בניין --</option>
                    {buildings.map(b => (
                      <option key={b.id} value={b.id}>{b.name}</option>
                    ))}
                  </select>
                </div>
              )}
              {editError && (
                <div className="bg-danger-50 ring-1 ring-danger-200 text-danger-600 px-3 py-2.5 rounded-lg text-sm">
                  {editError}
                </div>
              )}
              <div className="flex gap-2">
                <Button type="button" variant="secondary" className="flex-1" onClick={() => setEditingUser(null)}>
                  ביטול
                </Button>
                <Button type="submit" className="flex-1" disabled={updateMutation.isPending}>
                  {updateMutation.isPending ? 'שומר...' : 'שמור'}
                </Button>
              </div>
            </form>
        </Modal>
      )}

      {/* Invite Modal */}
      {showInviteModal && (
        <Modal open onClose={closeInviteModal} srTitle="הזמן משתמש חדש" size="md" hideClose className="p-6">
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-lg font-bold text-ink-900">הזמן משתמש חדש</h2>
              <button
                onClick={closeInviteModal}
                aria-label="סגור חלון"
                className="text-ink-500 hover:text-ink-700 text-2xl leading-none w-8 h-8 flex items-center justify-center rounded-lg hover:bg-ink-100"
              >
                ×
              </button>
            </div>

            {inviteResult ? (
              <div className="space-y-4">
                <div className="flex items-center gap-2.5 text-accent-700 bg-accent-50 rounded-lg p-3">
                  <svg className="w-5 h-5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                  <span className="font-medium text-sm">ההזמנה נוצרה בהצלחה!</span>
                </div>
                <p className="text-sm text-ink-700">שלח את הקישור הבא למשתמש (תקף ל-7 ימים):</p>
                <div className="bg-ink-50 border border-ink-200 rounded-xl p-3 text-xs break-all font-mono text-ink-700" dir="ltr">
                  {inviteResult}
                </div>
                <button
                  onClick={() => copyToClipboard(inviteResult)}
                  className={`w-full py-2.5 rounded-xl text-sm font-medium transition ${copied ? 'bg-accent-100 text-accent-700' : 'bg-primary-50 text-primary-700 hover:bg-primary-100'}`}
                >
                  {copied ? 'הועתק!' : 'העתק קישור'}
                </button>
                <button
                  onClick={closeInviteModal}
                  className="w-full py-2.5 rounded-xl text-sm font-medium bg-ink-100 text-ink-700 hover:bg-ink-200 transition"
                >
                  סגור
                </button>
              </div>
            ) : (
              <form onSubmit={handleInvite} className="space-y-4">
                <div>
                  <label htmlFor="usr-new-name" className="block text-[13px] font-medium text-ink-700 mb-1.5">שם מלא</label>
                  <input
                    id="usr-new-name"
                    type="text"
                    required
                    value={inviteForm.full_name}
                    onChange={e => setInviteForm(p => ({ ...p, full_name: e.target.value }))}
                    className="w-full px-4 py-2.5 rounded-lg ring-1 ring-ink-200 focus:outline-none focus:ring-2 focus:ring-primary-500 text-right"
                    placeholder="ישראל ישראלי"
                  />
                </div>

                <div>
                  <label htmlFor="usr-new-email" className="block text-[13px] font-medium text-ink-700 mb-1.5">אימייל</label>
                  <input
                    id="usr-new-email"
                    type="email"
                    required
                    value={inviteForm.email}
                    onChange={e => setInviteForm(p => ({ ...p, email: e.target.value }))}
                    className="w-full px-4 py-2.5 rounded-lg ring-1 ring-ink-200 focus:outline-none focus:ring-2 focus:ring-primary-500"
                    dir="ltr"
                    placeholder="user@example.com"
                  />
                </div>

                <div>
                  <label htmlFor="usr-new-role" className="block text-[13px] font-medium text-ink-700 mb-1.5">תפקיד</label>
                  <select
                    id="usr-new-role"
                    value={inviteForm.role}
                    onChange={e => setInviteForm(p => ({ ...p, role: e.target.value }))}
                    className="w-full px-4 py-2.5 rounded-lg ring-1 ring-ink-200 focus:outline-none focus:ring-2 focus:ring-primary-500"
                  >
                    <option value="worker">עובד – יכול לצפות ולערוך</option>
                    <option value="viewer">צופה – יכול לצפות בלבד</option>
                    <option value="tenant">דייר – רואה בניין שלו בלבד</option>
                    <option value="manager">מנהל – גישה מלאה</option>
                  </select>
                </div>

                {(inviteForm.role === 'tenant') && (
                  <div>
                    <label htmlFor="usr-new-building" className="block text-[13px] font-medium text-ink-700 mb-1.5">בניין (לדיירים)</label>
                    <select
                      id="usr-new-building"
                      value={inviteForm.building_id}
                      onChange={e => setInviteForm(p => ({ ...p, building_id: e.target.value }))}
                      className="w-full px-4 py-2.5 rounded-lg ring-1 ring-ink-200 focus:outline-none focus:ring-2 focus:ring-primary-500"
                    >
                      <option value="">-- בחר בניין --</option>
                      {buildings.map(b => (
                        <option key={b.id} value={b.id}>{b.name}</option>
                      ))}
                    </select>
                  </div>
                )}

                {inviteError && (
                  <div className="bg-danger-50 ring-1 ring-danger-200 text-danger-600 px-3 py-2.5 rounded-lg text-sm">
                    {inviteError}
                  </div>
                )}

                <Button type="submit" className="w-full">
                  צור קישור הזמנה
                </Button>
              </form>
            )}
        </Modal>
      )}
    </div>
  );
};

export default Users;
