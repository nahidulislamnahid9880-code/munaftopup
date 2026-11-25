import React, {useCallback, useEffect, useState} from 'react';
import {
  Activity,
  KeyRound,
  Mail,
  Plus,
  Save,
  Send,
  Server,
  Trash2,
  UserCheck,
} from 'lucide-react';
import {
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
} from 'firebase/firestore';
import {useAuth} from '../../contexts/AuthContext';
import {
  OperationType,
  SUPER_ADMIN_EMAIL,
  db,
  emailToStaffId,
  handleFirestoreError,
  timestampToMillis,
} from '../../lib/firebase';
import type {AuditLogEntry, StaffPermissions} from '../../types';
import {AdminLayout} from '../../components/admin/AdminLayout';

interface ServerStaffItem {
  email: string;
  name: string;
  role: 'super_admin' | 'admin' | 'sub_admin';
  active: boolean;
  permissions: StaffPermissions;
  hasPassword: boolean;
}

interface SystemSettingsForm {
  smtpHost: string;
  smtpPort: number;
  smtpUser: string;
  smtpPassword: string;
  hasSmtpPassword: boolean;
  smtpFromEmail: string;
  notificationEmail: string;
  smtpEnabled: boolean;
  distributorBaseUrl: string;
  distributorMerchantId: string;
  distributorApiKey: string;
  hasDistributorApiKey: boolean;
  distributorEnabled: boolean;
}

const DEFAULT_PERMS: StaffPermissions = {
  products: true,
  orders: true,
  payments: true,
  customers: false,
  customization: false,
  settings: false,
};

export function AdminSettings() {
  const {adminUser, firebaseUser, adminFetch} = useAuth();
  const canSettings = adminUser?.role === 'super_admin' || adminUser?.permissions.settings;
  const isSuper = adminUser?.role === 'super_admin';

  const [tab, setTab] = useState<'profile' | 'staff' | 'integrations' | 'logs'>('profile');

  // Profile & password
  const [profileName, setProfileName] = useState(adminUser?.name || '');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [profileMsg, setProfileMsg] = useState('');
  const [profileErr, setProfileErr] = useState('');

  // Sub-admins
  const [staffList, setStaffList] = useState<ServerStaffItem[]>([]);
  const [newStaffEmail, setNewStaffEmail] = useState('');
  const [newStaffName, setNewStaffName] = useState('');
  const [newStaffRole, setNewStaffRole] = useState<'sub_admin' | 'admin'>('sub_admin');
  const [newStaffPass, setNewStaffPass] = useState('');
  const [newStaffPerms, setNewStaffPerms] = useState<StaffPermissions>({...DEFAULT_PERMS});
  const [staffMsg, setStaffMsg] = useState('');

  // SMTP & Distributor API
  const [sysForm, setSysForm] = useState<SystemSettingsForm>({
    smtpHost: 'smtp.gmail.com',
    smtpPort: 587,
    smtpUser: '',
    smtpPassword: '',
    hasSmtpPassword: false,
    smtpFromEmail: '',
    notificationEmail: 'abdulmunafadmin@gmail.com',
    smtpEnabled: false,
    distributorBaseUrl: '',
    distributorMerchantId: '',
    distributorApiKey: '',
    hasDistributorApiKey: false,
    distributorEnabled: false,
  });
  const [sysMsg, setSysMsg] = useState('');
  const [sysErr, setSysErr] = useState('');
  const [testingEmail, setTestingEmail] = useState(false);

  // Audit logs
  const [auditLogs, setAuditLogs] = useState<AuditLogEntry[]>([]);
  const [serverLogs, setServerLogs] = useState<
    Array<{id: string; actorEmail: string; action: string; details: string; createdAt: string}>
  >([]);

  const loadServerData = useCallback(async () => {
    if (!canSettings) return;
    try {
      const [staffRes, sysRes, logsRes] = await Promise.all([
        adminFetch('/api/admin/staff'),
        adminFetch('/api/admin/system-settings'),
        adminFetch('/api/admin/server-logs'),
      ]);
      if (staffRes.ok) {
        const d = (await staffRes.json()) as {staff: ServerStaffItem[]};
        setStaffList(d.staff || []);
      }
      if (sysRes.ok) {
        const d = (await sysRes.json()) as {settings: Partial<SystemSettingsForm>};
        setSysForm((prev) => ({
          ...prev,
          ...d.settings,
          smtpPassword: '',
          distributorApiKey: '',
        }));
      }
      if (logsRes.ok) {
        const d = (await logsRes.json()) as {
          logs: Array<{id: string; actorEmail: string; action: string; details: string; createdAt: string}>;
        };
        setServerLogs(d.logs || []);
      }
    } catch {
      // ignore initial load error
    }
  }, [adminFetch, canSettings]);

  useEffect(() => {
    void loadServerData();
  }, [loadServerData]);

  useEffect(() => {
    if (!firebaseUser) return;
    const unsub = onSnapshot(
      query(collection(db, 'auditLogs'), orderBy('createdAt', 'desc')),
      (snap) => setAuditLogs(snap.docs.map((d) => d.data() as AuditLogEntry)),
      (err) => handleFirestoreError(err, OperationType.LIST, 'auditLogs'),
    );
    return () => unsub();
  }, [firebaseUser]);

  const handleUpdateProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setProfileMsg('');
    setProfileErr('');
    const res = await adminFetch('/api/admin/auth/change-password', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({
        name: profileName,
        currentPassword: currentPassword || undefined,
        newPassword: newPassword || undefined,
      }),
    });
    const data = (await res.json()) as {ok?: boolean; error?: string};
    if (!res.ok) {
      setProfileErr(data.error || 'Failed to update profile');
    } else {
      setCurrentPassword('');
      setNewPassword('');
      setProfileMsg('Profile and password updated.');
    }
  };

  const handleAddSubAdmin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isSuper || !adminUser) return;
    setStaffMsg('');
    const res = await adminFetch('/api/admin/staff', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({
        email: newStaffEmail,
        name: newStaffName,
        role: newStaffRole,
        active: true,
        permissions: newStaffPerms,
        password: newStaffPass || undefined,
      }),
    });
    const data = (await res.json()) as {staff?: ServerStaffItem; error?: string};
    if (!res.ok || !data.staff) {
      setStaffMsg(data.error || 'Failed to save sub-admin');
      return;
    }

    // Sync permission record into Firestore /staff/{staffId}
    if (firebaseUser) {
      const staffId = emailToStaffId(data.staff.email);
      const now = serverTimestamp();
      await setDoc(doc(db, 'staff', staffId), {
        id: staffId,
        email: data.staff.email,
        name: data.staff.name,
        role: data.staff.role,
        active: true,
        permissions: data.staff.permissions,
        createdBy: adminUser.email,
        createdAt: now,
        updatedAt: now,
      });
    }

    setNewStaffEmail('');
    setNewStaffName('');
    setNewStaffPass('');
    setStaffMsg(`Saved sub-admin ${data.staff.email}`);
    void loadServerData();
  };

  const handleDeleteStaff = async (email: string) => {
    if (!isSuper || email === SUPER_ADMIN_EMAIL) return;
    const res = await adminFetch(`/api/admin/staff/${encodeURIComponent(email)}`, {
      method: 'DELETE',
    });
    if (res.ok && firebaseUser) {
      await deleteDoc(doc(db, 'staff', emailToStaffId(email))).catch(() => null);
      void loadServerData();
    }
  };

  const handleSaveSystemSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setSysMsg('');
    setSysErr('');
    const res = await adminFetch('/api/admin/system-settings', {
      method: 'PUT',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify(sysForm),
    });
    const data = (await res.json()) as {ok?: boolean; error?: string};
    if (!res.ok) {
      setSysErr(data.error || 'Failed to save system settings');
    } else {
      setSysMsg('Server SMTP & Distributor API settings saved securely.');
      void loadServerData();
    }
  };

  const handleSendTestEmail = async () => {
    setSysMsg('');
    setSysErr('');
    setTestingEmail(true);
    try {
      const saveRes = await adminFetch('/api/admin/system-settings', {
        method: 'PUT',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(sysForm),
      });
      if (!saveRes.ok) {
        const saveErr = (await saveRes.json()) as {error?: string};
        setSysErr(saveErr.error || 'Failed to save settings before sending test email');
        return;
      }

      const res = await adminFetch('/api/admin/test-email', {
        method: 'POST',
      });
      const data = (await res.json()) as {ok?: boolean; toEmail?: string; error?: string; reason?: string};
      if (!res.ok || !data.ok) {
        setSysErr(data.error || data.reason || 'Failed to send test email');
      } else {
        setSysMsg(`Test email sent successfully to ${data.toEmail || sysForm.notificationEmail}!`);
        void loadServerData();
      }
    } catch {
      setSysErr('Network error while sending test email.');
    } finally {
      setTestingEmail(false);
    }
  };

  if (!canSettings) {
    return (
      <AdminLayout title="Admin Settings">
        <div className="rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-8 text-sm text-red-600">
          You do not have permission to access admin settings.
        </div>
      </AdminLayout>
    );
  }

  return (
    <AdminLayout title="Admin Settings & Security">
      <div className="space-y-6">
        <div className="flex items-center gap-1 p-1 bg-slate-200/70 dark:bg-slate-800 rounded-xl overflow-x-auto w-fit max-w-full">
          <button
            type="button"
            onClick={() => setTab('profile')}
            className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold whitespace-nowrap cursor-pointer ${
              tab === 'profile'
                ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-sm'
                : 'text-slate-600 dark:text-slate-400'
            }`}>
            <KeyRound className="w-3.5 h-3.5" /> Profile &amp; Password
          </button>
          <button
            type="button"
            onClick={() => setTab('staff')}
            className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold whitespace-nowrap cursor-pointer ${
              tab === 'staff'
                ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-sm'
                : 'text-slate-600 dark:text-slate-400'
            }`}>
            <UserCheck className="w-3.5 h-3.5" /> Sub-Admins ({staffList.length})
          </button>
          <button
            type="button"
            onClick={() => setTab('integrations')}
            className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold whitespace-nowrap cursor-pointer ${
              tab === 'integrations'
                ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-sm'
                : 'text-slate-600 dark:text-slate-400'
            }`}>
            <Server className="w-3.5 h-3.5" /> SMTP &amp; Distributor API
          </button>
          <button
            type="button"
            onClick={() => setTab('logs')}
            className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold whitespace-nowrap cursor-pointer ${
              tab === 'logs'
                ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-sm'
                : 'text-slate-600 dark:text-slate-400'
            }`}>
            <Activity className="w-3.5 h-3.5" /> Activity Logs
          </button>
        </div>

        {/* Tab 1: Profile & Password */}
        {tab === 'profile' && (
          <form
            onSubmit={handleUpdateProfile}
            className="max-w-lg rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-6 space-y-4">
            <h2 className="text-base font-bold font-display">Admin Profile &amp; Password</h2>
            <div>
              <label className="block text-xs font-medium mb-1">Display Name</label>
              <input
                type="text"
                value={profileName}
                onChange={(e) => setProfileName(e.target.value)}
                className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">
                Current Password (leave blank if setting password for the first time)
              </label>
              <input
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">New Password (min 8 chars)</label>
              <input
                type="password"
                minLength={8}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
              />
            </div>
            {profileErr && <p className="text-xs text-red-600">{profileErr}</p>}
            {profileMsg && <p className="text-xs text-emerald-600 font-medium">{profileMsg}</p>}
            <button
              type="submit"
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold cursor-pointer">
              <Save className="w-3.5 h-3.5" /> Save Profile
            </button>
          </form>
        )}

        {/* Tab 2: Sub-Admins */}
        {tab === 'staff' && (
          <div className="space-y-6">
            {isSuper && (
              <form
                onSubmit={handleAddSubAdmin}
                className="rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-6 space-y-4">
                <h2 className="text-base font-bold font-display">Add or Update Sub-Admin</h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                  <input
                    type="email"
                    required
                    value={newStaffEmail}
                    onChange={(e) => setNewStaffEmail(e.target.value)}
                    placeholder="Staff Google Email"
                    className="px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                  />
                  <input
                    type="text"
                    required
                    value={newStaffName}
                    onChange={(e) => setNewStaffName(e.target.value)}
                    placeholder="Full Name"
                    className="px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                  />
                  <select
                    value={newStaffRole}
                    onChange={(e) => setNewStaffRole(e.target.value as 'sub_admin' | 'admin')}
                    className="px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950">
                    <option value="sub_admin">Sub-Admin</option>
                    <option value="admin">Admin</option>
                  </select>
                  <input
                    type="password"
                    minLength={8}
                    value={newStaffPass}
                    onChange={(e) => setNewStaffPass(e.target.value)}
                    placeholder="Optional Password (8+ chars)"
                    className="px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                  />
                </div>

                <div className="flex flex-wrap gap-5 pt-2">
                  {(Object.keys(DEFAULT_PERMS) as Array<keyof StaffPermissions>).map((perm) => (
                    <label key={perm} className="flex items-center gap-2 text-xs font-semibold capitalize cursor-pointer">
                      <input
                        type="checkbox"
                        checked={newStaffPerms[perm]}
                        onChange={(e) =>
                          setNewStaffPerms({...newStaffPerms, [perm]: e.target.checked})
                        }
                      />
                      {perm}
                    </label>
                  ))}
                </div>

                {staffMsg && <p className="text-xs text-blue-600 font-medium">{staffMsg}</p>}

                <button
                  type="submit"
                  className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold cursor-pointer">
                  <Plus className="w-3.5 h-3.5" /> Save Sub-Admin
                </button>
              </form>
            )}

            <div className="rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="bg-slate-50 dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-800 text-xs text-slate-500">
                    <tr>
                      <th className="px-4 py-3 font-medium">Staff Member</th>
                      <th className="px-4 py-3 font-medium">Role</th>
                      <th className="px-4 py-3 font-medium">Permissions</th>
                      <th className="px-4 py-3 font-medium text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {staffList.map((s) => (
                      <tr key={s.email}>
                        <td className="px-4 py-3">
                          <p className="font-semibold">{s.name}</p>
                          <p className="text-xs text-slate-500">{s.email}</p>
                        </td>
                        <td className="px-4 py-3 text-xs font-semibold capitalize">
                          {s.role.replace('_', ' ')}
                        </td>
                        <td className="px-4 py-3 text-xs text-slate-600 dark:text-slate-400">
                          {Object.entries(s.permissions)
                            .filter(([, v]) => v)
                            .map(([k]) => k)
                            .join(' · ') || 'None'}
                        </td>
                        <td className="px-4 py-3 text-right">
                          {isSuper && s.email !== SUPER_ADMIN_EMAIL && (
                            <button
                              type="button"
                              onClick={() => void handleDeleteStaff(s.email)}
                              className="p-1.5 rounded-lg text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40 cursor-pointer">
                              <Trash2 className="w-4 h-4" />
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* Tab 3: SMTP & Distributor API */}
        {tab === 'integrations' && (
          <form
            onSubmit={handleSaveSystemSettings}
            className="rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-6 space-y-6">
            <div className="space-y-4">
              <h2 className="text-base font-bold font-display flex items-center gap-2">
                <Mail className="w-4 h-4 text-blue-600" /> Server SMTP &amp; Email Alerts
              </h2>
              <p className="text-xs text-slate-600 dark:text-slate-400">
                Customer orders, support complaints/tickets, and wallet deposits automatically notify the recipient email below. For Gmail, use host <code className="font-mono">smtp.gmail.com</code>, port <code className="font-mono">587</code>, your Gmail address as Username, and a 16-character Google App Password (or set <code className="font-mono">SMTP_USER</code> / <code className="font-mono">SMTP_PASSWORD</code> env vars on Render).
              </p>
              <label className="flex items-center gap-2 text-xs font-semibold cursor-pointer">
                <input
                  type="checkbox"
                  checked={sysForm.smtpEnabled}
                  onChange={(e) => setSysForm({...sysForm, smtpEnabled: e.target.checked})}
                />
                Enable Outbound SMTP Email Notifications
              </label>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className="block text-[11px] font-semibold text-slate-500 mb-1">
                    Notification Recipient Email *
                  </label>
                  <input
                    type="email"
                    value={sysForm.notificationEmail}
                    onChange={(e) => setSysForm({...sysForm, notificationEmail: e.target.value})}
                    placeholder="abdulmunafadmin@gmail.com"
                    className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-slate-500 mb-1">
                    SMTP Host
                  </label>
                  <input
                    type="text"
                    value={sysForm.smtpHost}
                    onChange={(e) => setSysForm({...sysForm, smtpHost: e.target.value})}
                    placeholder="smtp.gmail.com"
                    className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-slate-500 mb-1">
                    SMTP Port
                  </label>
                  <input
                    type="number"
                    value={sysForm.smtpPort}
                    onChange={(e) => setSysForm({...sysForm, smtpPort: Number(e.target.value)})}
                    placeholder="587"
                    className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-slate-500 mb-1">
                    SMTP Username (Sender Gmail)
                  </label>
                  <input
                    type="text"
                    value={sysForm.smtpUser}
                    onChange={(e) => setSysForm({...sysForm, smtpUser: e.target.value})}
                    placeholder="yourgmail@gmail.com"
                    className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-slate-500 mb-1">
                    SMTP App Password
                  </label>
                  <input
                    type="password"
                    value={sysForm.smtpPassword}
                    onChange={(e) => setSysForm({...sysForm, smtpPassword: e.target.value})}
                    placeholder={sysForm.hasSmtpPassword ? '•••••••• (Saved on server)' : '16-char Google App Password'}
                    className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-slate-500 mb-1">
                    From Email (Optional)
                  </label>
                  <input
                    type="text"
                    value={sysForm.smtpFromEmail}
                    onChange={(e) => setSysForm({...sysForm, smtpFromEmail: e.target.value})}
                    placeholder="Defaults to SMTP Username"
                    className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                  />
                </div>
              </div>
            </div>

            <div className="pt-5 border-t border-slate-200 dark:border-slate-800 space-y-4">
              <h2 className="text-base font-bold font-display flex items-center gap-2">
                <Server className="w-4 h-4 text-blue-600" /> Authorized Distributor API
              </h2>
              <label className="flex items-center gap-2 text-xs font-semibold cursor-pointer">
                <input
                  type="checkbox"
                  checked={sysForm.distributorEnabled}
                  onChange={(e) =>
                    setSysForm({...sysForm, distributorEnabled: e.target.checked})
                  }
                />
                Enable Authorized Distributor API Integration
              </label>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <input
                  type="url"
                  value={sysForm.distributorBaseUrl}
                  onChange={(e) =>
                    setSysForm({...sysForm, distributorBaseUrl: e.target.value})
                  }
                  placeholder="https://api.distributor.example"
                  className="px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                />
                <input
                  type="text"
                  value={sysForm.distributorMerchantId}
                  onChange={(e) =>
                    setSysForm({...sysForm, distributorMerchantId: e.target.value})
                  }
                  placeholder="Merchant ID"
                  className="px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                />
                <input
                  type="password"
                  value={sysForm.distributorApiKey}
                  onChange={(e) =>
                    setSysForm({...sysForm, distributorApiKey: e.target.value})
                  }
                  placeholder={
                    sysForm.hasDistributorApiKey ? '•••••••• (Saved on server)' : 'API Secret Key'
                  }
                  className="px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                />
              </div>
            </div>

            {sysErr && <p className="text-xs text-red-600 font-medium">{sysErr}</p>}
            {sysMsg && <p className="text-xs text-emerald-600 font-medium">{sysMsg}</p>}

            <div className="flex flex-wrap items-center gap-3">
              <button
                type="submit"
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold cursor-pointer">
                <Save className="w-3.5 h-3.5" /> Save Secure Server Settings
              </button>
              <button
                type="button"
                disabled={testingEmail}
                onClick={() => void handleSendTestEmail()}
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-slate-900 hover:bg-slate-800 disabled:bg-slate-400 text-white text-xs font-semibold cursor-pointer">
                <Send className="w-3.5 h-3.5" /> {testingEmail ? 'Sending...' : 'Send Test Email'}
              </button>
            </div>
          </form>
        )}

        {/* Tab 4: Audit & Activity Logs */}
        {tab === 'logs' && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 overflow-hidden">
              <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800 font-bold text-sm">
                Database Audit Trail
              </div>
              <div className="divide-y divide-slate-100 dark:divide-slate-800 max-h-[500px] overflow-y-auto">
                {auditLogs.map((log) => (
                  <div key={log.id} className="p-3.5 text-xs space-y-1">
                    <div className="flex items-center justify-between font-semibold">
                      <span>{log.action}</span>
                      <span className="text-slate-500 tabular-nums">
                        {new Date(timestampToMillis(log.createdAt)).toLocaleString()}
                      </span>
                    </div>
                    <p className="text-slate-600 dark:text-slate-400">{log.details}</p>
                    <p className="text-[11px] text-slate-400">
                      {log.actorEmail} ({log.actorRole})
                    </p>
                  </div>
                ))}
                {auditLogs.length === 0 && (
                  <p className="p-6 text-center text-xs text-slate-500">No audit entries yet.</p>
                )}
              </div>
            </div>

            <div className="rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 overflow-hidden">
              <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800 font-bold text-sm">
                Server Auth &amp; Security Log
              </div>
              <div className="divide-y divide-slate-100 dark:divide-slate-800 max-h-[500px] overflow-y-auto">
                {serverLogs.map((log) => (
                  <div key={log.id} className="p-3.5 text-xs space-y-1">
                    <div className="flex items-center justify-between font-semibold">
                      <span>{log.action}</span>
                      <span className="text-slate-500 tabular-nums">
                        {new Date(log.createdAt).toLocaleString()}
                      </span>
                    </div>
                    <p className="text-slate-600 dark:text-slate-400">{log.details}</p>
                    <p className="text-[11px] text-slate-400">{log.actorEmail}</p>
                  </div>
                ))}
                {serverLogs.length === 0 && (
                  <p className="p-6 text-center text-xs text-slate-500">No server logs yet.</p>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </AdminLayout>
  );
}
