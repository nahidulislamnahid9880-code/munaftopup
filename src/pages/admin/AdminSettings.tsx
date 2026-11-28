import React, {useCallback, useEffect, useState} from 'react';
import {
  Activity,
  ArrowDown,
  ArrowUp,
  Award,
  Bot,
  Code2,
  Copy,
  CreditCard,
  KeyRound,
  Mail,
  MessageSquarePlus,
  Plus,
  RotateCcw,
  Save,
  Search,
  Send,
  Server,
  ShieldAlert,
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

type TelegramQuickReplyAction = 'reply' | 'show_list' | 'order_status' | 'request_agent';

interface TelegramQuickReplyPreset {
  id: string;
  label: string;
  replyText: string;
  action: TelegramQuickReplyAction;
  active: boolean;
}

const DEFAULT_TELEGRAM_QUICK_REPLIES: TelegramQuickReplyPreset[] = [
  {
    id: 'payment_received',
    label: 'Payment Received',
    replyText: '✅ আপনার পেমেন্ট রিসিভ হয়েছে! আমাদের টিম দ্রুত ভেরিফাই করে আপনার অর্ডার কমপ্লিট করছে।',
    action: 'reply',
    active: true,
  },
  {
    id: 'order_processing',
    label: 'Order Processing',
    replyText: '⏳ আপনার অর্ডারটি বর্তমানে প্রসেসিং অবস্থায় আছে। সাধারণত ১–৫ মিনিটের মধ্যে ডেলিভারি সম্পন্ন হয়।',
    action: 'reply',
    active: true,
  },
  {
    id: 'rate_list',
    label: '💎 Rate List',
    replyText: 'আজকের প্যাকেজ ও ডায়মন্ড রেট লিস্ট নিচে দেখুন:',
    action: 'show_list',
    active: true,
  },
  {
    id: 'my_orders',
    label: '🧾 My Orders',
    replyText: 'আপনার সাম্প্রতিক অর্ডারের অবস্থা নিচে দেওয়া হলো:',
    action: 'order_status',
    active: true,
  },
  {
    id: 'support_agent',
    label: '👨‍💼 Support Agent',
    replyText: '🙋‍♂️ আপনার অনুরোধটি এডমিনের কাছে পাঠানো হয়েছে। কিছুক্ষণের মধ্যে আমাদের এজেন্ট আপনার সাথে যোগাযোগ করবেন।',
    action: 'request_agent',
    active: true,
  },
];

interface SystemSettingsForm {
  smtpHost: string;
  smtpPort: number;
  smtpUser: string;
  smtpPassword: string;
  hasSmtpPassword: boolean;
  smtpFromEmail: string;
  notificationEmail: string;
  smtpEnabled: boolean;
  customerEmailNotificationsEnabled: boolean;
  distributorBaseUrl: string;
  distributorMerchantId: string;
  distributorApiKey: string;
  hasDistributorApiKey: boolean;
  distributorEnabled: boolean;
  telegramQuickRepliesEnabled: boolean;
  telegramQuickReplies: TelegramQuickReplyPreset[];
  telegramAdminChatIdsInput: string;
  telegramAdminOrderAlerts: boolean;
  playerLookupBaseUrl: string;
  playerLookupApiKey: string;
  hasPlayerLookupApiKey: boolean;
  autoApproveReviews: boolean;
}

interface ResellerApiKeyItem {
  id: string;
  label: string;
  customerUid: string;
  customerEmail: string;
  keyPrefix: string;
  active: boolean;
  totalRequests: number;
  totalSpent: number;
  createdAtMs: number;
  lastUsedAtMs: number;
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

  // SMTP, Distributor API & Telegram Quick-Replies
  const [sysForm, setSysForm] = useState<SystemSettingsForm>({
    smtpHost: 'smtp.gmail.com',
    smtpPort: 587,
    smtpUser: '',
    smtpPassword: '',
    hasSmtpPassword: false,
    smtpFromEmail: '',
    notificationEmail: 'abdulmunafadmin@gmail.com',
    smtpEnabled: false,
    customerEmailNotificationsEnabled: true,
    distributorBaseUrl: '',
    distributorMerchantId: '',
    distributorApiKey: '',
    hasDistributorApiKey: false,
    distributorEnabled: false,
    telegramQuickRepliesEnabled: true,
    telegramQuickReplies: DEFAULT_TELEGRAM_QUICK_REPLIES.map((p) => ({...p})),
    telegramAdminChatIdsInput: '',
    telegramAdminOrderAlerts: true,
    playerLookupBaseUrl: '',
    playerLookupApiKey: '',
    hasPlayerLookupApiKey: false,
    autoApproveReviews: false,
  });
  const [newQuickLabel, setNewQuickLabel] = useState('');
  const [newQuickAction, setNewQuickAction] = useState<TelegramQuickReplyAction>('reply');
  const [newQuickReplyText, setNewQuickReplyText] = useState('');
  const [sysMsg, setSysMsg] = useState('');
  const [sysErr, setSysErr] = useState('');
  const [testingEmail, setTestingEmail] = useState(false);
  const [testingDistributor, setTestingDistributor] = useState(false);
  const [distributorTestResult, setDistributorTestResult] = useState('');

  // Commerce, Loyalty, Fraud & Merchant Payment Gateway settings
  const [commerceForm, setCommerceForm] = useState({
    vipSpendThreshold: 5000,
    vipDiscountPercent: 2,
    resellerSpendThreshold: 20000,
    resellerDiscountPercent: 5,
    referralBonusAmount: 20,
    loyaltyPercent: 1,
    loyaltyPointValueBdt: 1,
    fraudMaxFailedTrxPerHour: 5,
    fraudMaxOrdersPer10Min: 4,
    gatewayEnabled: false,
    gatewayProvider: 'none' as
      | 'none'
      | 'uddoktapay'
      | 'sslcommerz'
      | 'bkash_merchant'
      | 'nagad_merchant',
    gatewayBaseUrl: '',
    gatewayApiKey: '',
    hasGatewayApiKey: false,
    gatewayWebhookSecret: '',
    hasGatewayWebhookSecret: false,
  });
  const [savingCommerce, setSavingCommerce] = useState(false);
  const [commerceMsg, setCommerceMsg] = useState('');
  const [commerceErr, setCommerceErr] = useState('');

  // Public Reseller / Developer API v1 Keys
  const [resellerKeys, setResellerKeys] = useState<ResellerApiKeyItem[]>([]);
  const [newKeyEmail, setNewKeyEmail] = useState('');
  const [newKeyLabel, setNewKeyLabel] = useState('');
  const [issuingKey, setIssuingKey] = useState(false);
  const [revealedKey, setRevealedKey] = useState<{
    rawKey: string;
    label: string;
    customerEmail: string;
  } | null>(null);
  const [resellerMsg, setResellerMsg] = useState('');
  const [resellerErr, setResellerErr] = useState('');

  // Audit & API logs
  const [auditLogs, setAuditLogs] = useState<AuditLogEntry[]>([]);
  const [serverLogs, setServerLogs] = useState<
    Array<{id: string; actorEmail: string; action: string; details: string; createdAt: string}>
  >([]);
  const [apiLogs, setApiLogs] = useState<
    Array<{
      id: string;
      type: string;
      orderNumber: string;
      endpoint: string;
      status: string;
      httpStatus?: number;
      message: string;
      responsePreview?: string;
      createdAtIso?: string;
    }>
  >([]);
  const [autoStatus, setAutoStatus] = useState<{
    firebaseAdminMode: string;
    firebaseProjectId: string;
    firestoreDatabaseId: string;
    firestoreConnected: boolean;
    emailTransport?: 'brevo' | 'smtp' | 'none';
    brevoConfigured?: boolean;
    brevoSenderConfigured?: boolean;
    smsWebhookConfigured: boolean;
    telegramBotConfigured: boolean;
    telegramBotRunning: boolean;
    telegramBotUsername: string;
    telegramBotProcessedUpdates: number;
    telegramBotLastPollAt: string;
    telegramBotLastError: string;
    telegramAdminCount?: number;
    geminiConfigured?: boolean;
    geminiModel?: string;
    bkashNumberMasked: string;
    nagadNumberMasked: string;
  } | null>(null);

  const loadServerData = useCallback(async () => {
    if (!canSettings) return;
    try {
      const [staffRes, sysRes, logsRes, autoRes, commerceRes, apiLogsRes, resellerKeysRes] = await Promise.all([
        adminFetch('/api/admin/staff'),
        adminFetch('/api/admin/system-settings'),
        adminFetch('/api/admin/server-logs'),
        adminFetch('/api/admin/automation-status'),
        adminFetch('/api/admin/commerce-settings'),
        adminFetch('/api/admin/api-logs'),
        adminFetch('/api/admin/reseller-keys'),
      ]);
      if (staffRes.ok) {
        const d = (await staffRes.json()) as {staff: ServerStaffItem[]};
        setStaffList(d.staff || []);
      }
      if (sysRes.ok) {
        const d = (await sysRes.json()) as {
          settings: Partial<SystemSettingsForm> & {telegramAdminChatIds?: string[]};
        };
        setSysForm((prev) => ({
          ...prev,
          ...d.settings,
          smtpPassword: '',
          distributorApiKey: '',
          playerLookupApiKey: '',
          autoApproveReviews: d.settings.autoApproveReviews === true,
          customerEmailNotificationsEnabled: d.settings.customerEmailNotificationsEnabled !== false,
          telegramQuickRepliesEnabled: d.settings.telegramQuickRepliesEnabled !== false,
          telegramQuickReplies: Array.isArray(d.settings.telegramQuickReplies)
            ? d.settings.telegramQuickReplies
            : prev.telegramQuickReplies,
          telegramAdminChatIdsInput: Array.isArray(d.settings.telegramAdminChatIds)
            ? d.settings.telegramAdminChatIds.join(', ')
            : prev.telegramAdminChatIdsInput,
          telegramAdminOrderAlerts: d.settings.telegramAdminOrderAlerts !== false,
        }));
      }
      if (logsRes.ok) {
        const d = (await logsRes.json()) as {
          logs: Array<{id: string; actorEmail: string; action: string; details: string; createdAt: string}>;
        };
        setServerLogs(d.logs || []);
      }
      if (autoRes.ok) {
        const d = (await autoRes.json()) as NonNullable<typeof autoStatus>;
        setAutoStatus(d);
      }
      if (commerceRes.ok) {
        const d = (await commerceRes.json()) as {
          settings?: Partial<typeof commerceForm>;
        };
        if (d.settings) {
          setCommerceForm((prev) => ({
            ...prev,
            ...d.settings,
            gatewayApiKey: '',
            gatewayWebhookSecret: '',
          }));
        }
      }
      if (apiLogsRes.ok) {
        const d = (await apiLogsRes.json()) as {logs?: typeof apiLogs};
        setApiLogs(d.logs || []);
      }
      if (resellerKeysRes.ok) {
        const d = (await resellerKeysRes.json()) as {keys?: ResellerApiKeyItem[]};
        setResellerKeys(d.keys || []);
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

  const handleAddQuickReply = () => {
    const label = newQuickLabel.trim().slice(0, 40);
    if (!label) {
      setSysErr('Please enter a quick-reply button label.');
      return;
    }
    setSysErr('');
    const baseId =
      label
        .toLowerCase()
        .replace(/[^a-z0-9_]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 26) || 'preset';
    const uniqueId = `${baseId}_${Date.now().toString(36).slice(-4)}`;
    const nextItem: TelegramQuickReplyPreset = {
      id: uniqueId,
      label,
      action: newQuickAction,
      replyText: newQuickReplyText.trim(),
      active: true,
    };
    setSysForm((prev) => ({
      ...prev,
      telegramQuickReplies: [...prev.telegramQuickReplies, nextItem],
    }));
    setNewQuickLabel('');
    setNewQuickAction('reply');
    setNewQuickReplyText('');
  };

  const handleUpdateQuickReply = (
    id: string,
    patch: Partial<TelegramQuickReplyPreset>,
  ) => {
    setSysForm((prev) => ({
      ...prev,
      telegramQuickReplies: prev.telegramQuickReplies.map((item) =>
        item.id === id ? {...item, ...patch} : item,
      ),
    }));
  };

  const handleMoveQuickReply = (index: number, delta: -1 | 1) => {
    setSysForm((prev) => {
      const target = index + delta;
      if (target < 0 || target >= prev.telegramQuickReplies.length) return prev;
      const copy = [...prev.telegramQuickReplies];
      const [moved] = copy.splice(index, 1);
      copy.splice(target, 0, moved);
      return {...prev, telegramQuickReplies: copy};
    });
  };

  const handleDeleteQuickReply = (id: string) => {
    setSysForm((prev) => ({
      ...prev,
      telegramQuickReplies: prev.telegramQuickReplies.filter((item) => item.id !== id),
    }));
  };

  const handleRestoreDefaultQuickReplies = () => {
    setSysForm((prev) => ({
      ...prev,
      telegramQuickRepliesEnabled: true,
      telegramQuickReplies: DEFAULT_TELEGRAM_QUICK_REPLIES.map((p) => ({...p})),
    }));
    setSysMsg('Default quick-reply presets restored in editor. Click Save to apply.');
  };

  const buildSystemSettingsPayload = () => ({
    ...sysForm,
    telegramAdminChatIds: sysForm.telegramAdminChatIdsInput
      .split(/[\s,;]+/)
      .map((s) => s.trim())
      .filter((s) => /^-?\d+$/.test(s)),
  });

  const handleSaveSystemSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setSysMsg('');
    setSysErr('');
    const res = await adminFetch('/api/admin/system-settings', {
      method: 'PUT',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify(buildSystemSettingsPayload()),
    });
    const data = (await res.json()) as {ok?: boolean; error?: string};
    if (!res.ok) {
      setSysErr(data.error || 'Failed to save system settings');
    } else {
      setSysMsg('Server settings, Customer Email Alerts & Telegram Admin settings saved securely.');
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
        body: JSON.stringify(buildSystemSettingsPayload()),
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

  const handleTestDistributor = async () => {
    setTestingDistributor(true);
    setDistributorTestResult('');
    try {
      const res = await adminFetch('/api/admin/distributor/test', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
          distributorBaseUrl: sysForm.distributorBaseUrl,
          distributorApiKey: sysForm.distributorApiKey || undefined,
          distributorMerchantId: sysForm.distributorMerchantId,
        }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        httpStatus?: number;
        preview?: string;
        error?: string;
      };
      if (res.ok && data.ok) {
        setDistributorTestResult(
          `Connected cleanly (HTTP ${data.httpStatus ?? 200}). ${data.preview ? data.preview.slice(0, 120) : ''}`,
        );
      } else {
        setDistributorTestResult(
          data.error || `Distributor test returned HTTP ${data.httpStatus ?? res.status}.`,
        );
      }
    } catch {
      setDistributorTestResult('Network error while testing Distributor API endpoint.');
    } finally {
      setTestingDistributor(false);
    }
  };

  const handleSaveCommerceSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingCommerce(true);
    setCommerceMsg('');
    setCommerceErr('');
    try {
      const res = await adminFetch('/api/admin/commerce-settings', {
        method: 'PUT',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(commerceForm),
      });
      const data = (await res.json()) as {ok?: boolean; error?: string};
      if (!res.ok || !data.ok) {
        setCommerceErr(data.error || 'Failed to save commerce & gateway settings.');
      } else {
        setCommerceMsg('VIP/Loyalty rules, Fraud thresholds & Merchant Gateway settings saved.');
        void loadServerData();
      }
    } catch {
      setCommerceErr('Network error saving commerce settings.');
    } finally {
      setSavingCommerce(false);
    }
  };

  const handleIssueResellerKey = async (e: React.FormEvent) => {
    e.preventDefault();
    setResellerErr('');
    setResellerMsg('');
    setRevealedKey(null);
    if (!newKeyEmail.trim()) {
      setResellerErr('Please enter a registered customer email.');
      return;
    }
    setIssuingKey(true);
    try {
      const res = await adminFetch('/api/admin/reseller-keys', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
          customerEmail: newKeyEmail.trim().toLowerCase(),
          label: newKeyLabel.trim() || 'Reseller API Key',
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        rawKey?: string;
        key?: {label?: string; customerEmail?: string};
        error?: string;
      };
      if (!res.ok || !data.ok || !data.rawKey) {
        setResellerErr(data.error || 'Failed to issue reseller API key.');
        return;
      }
      setRevealedKey({
        rawKey: data.rawKey,
        label: data.key?.label || newKeyLabel.trim() || 'Reseller API Key',
        customerEmail: data.key?.customerEmail || newKeyEmail.trim().toLowerCase(),
      });
      setNewKeyEmail('');
      setNewKeyLabel('');
      setResellerMsg('Reseller API key created. Copy the secret key below now — it will not be shown again.');
      void loadServerData();
    } catch {
      setResellerErr('Network error creating reseller key.');
    } finally {
      setIssuingKey(false);
    }
  };

  const handleToggleResellerKey = async (item: ResellerApiKeyItem) => {
    setResellerErr('');
    try {
      const res = await adminFetch(`/api/admin/reseller-keys/${encodeURIComponent(item.id)}`, {
        method: 'PATCH',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({active: !item.active}),
      });
      if (res.ok) {
        setResellerKeys((prev) =>
          prev.map((k) => (k.id === item.id ? {...k, active: !item.active} : k)),
        );
      } else {
        setResellerErr('Could not toggle API key status.');
      }
    } catch {
      setResellerErr('Network error toggling API key.');
    }
  };

  const handleDeleteResellerKey = async (keyId: string) => {
    setResellerErr('');
    try {
      const res = await adminFetch(`/api/admin/reseller-keys/${encodeURIComponent(keyId)}`, {
        method: 'DELETE',
      });
      if (res.ok) {
        setResellerKeys((prev) => prev.filter((k) => k.id !== keyId));
        setResellerMsg('Reseller API key revoked and deleted.');
      } else {
        setResellerErr('Failed to delete API key.');
      }
    } catch {
      setResellerErr('Network error deleting API key.');
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
            <Server className="w-3.5 h-3.5" /> Integrations &amp; Commerce
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

        {/* Tab 3: Integrations & Commerce */}
        {tab === 'integrations' && (
          <div className="space-y-6">
          <form
            onSubmit={handleSaveSystemSettings}
            className="rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-6 space-y-6">
            <div className="space-y-4">
              <h2 className="text-base font-bold font-display flex items-center gap-2">
                <Mail className="w-4 h-4 text-blue-600" /> Server SMTP &amp; Email Alerts
              </h2>
              <p className="text-xs text-slate-600 dark:text-slate-400">
                Customer orders, support complaints/tickets, and wallet deposits automatically notify the recipient email below. When <code className="font-mono">BREVO_API_KEY</code> and <code className="font-mono">BREVO_SENDER_EMAIL</code> are set, emails are sent over HTTPS via Brevo REST API (recommended on Render to bypass SMTP port limits). Otherwise Nodemailer SMTP is used.
              </p>
              <div className="flex flex-wrap gap-4">
                <label className="flex items-center gap-2 text-xs font-semibold cursor-pointer">
                  <input
                    type="checkbox"
                    checked={sysForm.smtpEnabled}
                    onChange={(e) => setSysForm({...sysForm, smtpEnabled: e.target.checked})}
                  />
                  Enable Outbound SMTP Email Notifications
                </label>
                <label className="flex items-center gap-2 text-xs font-semibold cursor-pointer">
                  <input
                    type="checkbox"
                    checked={sysForm.customerEmailNotificationsEnabled}
                    onChange={(e) =>
                      setSysForm({...sysForm, customerEmailNotificationsEnabled: e.target.checked})
                    }
                  />
                  Send Automated Order &amp; Voucher Emails to Customer Email
                </label>
              </div>
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
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="text-base font-bold font-display flex items-center gap-2">
                  <Server className="w-4 h-4 text-blue-600" /> Authorized Distributor API
                </h2>
                <button
                  type="button"
                  disabled={testingDistributor}
                  onClick={() => void handleTestDistributor()}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 text-xs font-semibold cursor-pointer disabled:opacity-50">
                  <Server className="w-3.5 h-3.5 text-cyan-600" />
                  {testingDistributor ? 'Testing...' : 'Test Connection'}
                </button>
              </div>
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
              {distributorTestResult && (
                <p className="text-xs font-medium text-cyan-700 dark:text-cyan-400">
                  {distributorTestResult}
                </p>
              )}
            </div>

            <div className="pt-5 border-t border-slate-200 dark:border-slate-800 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-base font-bold font-display flex items-center gap-2">
                    <MessageSquarePlus className="w-4 h-4 text-blue-600" /> Telegram Bot Quick-Reply Buttons (Inline Keyboard)
                  </h2>
                  <p className="text-xs text-slate-600 dark:text-slate-400 mt-0.5">
                    Configure preset inline keyboard buttons (e.g. Payment Received, Order Processing) presented to customers inside Telegram messages.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleRestoreDefaultQuickReplies}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer">
                  <RotateCcw className="w-3.5 h-3.5" /> Restore Defaults
                </button>
              </div>

              <label className="flex items-center gap-2 text-xs font-semibold cursor-pointer">
                <input
                  type="checkbox"
                  checked={sysForm.telegramQuickRepliesEnabled}
                  onChange={(e) =>
                    setSysForm({...sysForm, telegramQuickRepliesEnabled: e.target.checked})
                  }
                />
                Show Active Quick-Reply Inline Keyboard Buttons on Telegram Bot Messages
              </label>

              {/* Preset Editor List */}
              <div className="space-y-3">
                {sysForm.telegramQuickReplies.map((preset, index) => (
                  <div
                    key={preset.id}
                    className="p-3.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/60 space-y-2.5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2.5">
                        <span className="text-[11px] font-mono font-bold text-slate-500 tabular-nums">
                          #{index + 1}
                        </span>
                        <label className="inline-flex items-center gap-1.5 text-xs font-semibold cursor-pointer">
                          <input
                            type="checkbox"
                            checked={preset.active}
                            onChange={(e) =>
                              handleUpdateQuickReply(preset.id, {active: e.target.checked})
                            }
                          />
                          Active
                        </label>
                      </div>
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => handleMoveQuickReply(index, -1)}
                          disabled={index === 0}
                          title="Move up"
                          className="p-1.5 rounded-md border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 disabled:opacity-40 hover:bg-white dark:hover:bg-slate-900 cursor-pointer">
                          <ArrowUp className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleMoveQuickReply(index, 1)}
                          disabled={index === sysForm.telegramQuickReplies.length - 1}
                          title="Move down"
                          className="p-1.5 rounded-md border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 disabled:opacity-40 hover:bg-white dark:hover:bg-slate-900 cursor-pointer">
                          <ArrowDown className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteQuickReply(preset.id)}
                          title="Remove preset"
                          className="p-1.5 rounded-md text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40 cursor-pointer">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-[11px] font-semibold text-slate-500 mb-1">
                          Button Label (Max 40 chars)
                        </label>
                        <input
                          type="text"
                          maxLength={40}
                          value={preset.label}
                          onChange={(e) =>
                            handleUpdateQuickReply(preset.id, {label: e.target.value})
                          }
                          placeholder="e.g. Payment Received"
                          className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] font-semibold text-slate-500 mb-1">
                          Button Tap Action
                        </label>
                        <select
                          value={preset.action}
                          onChange={(e) =>
                            handleUpdateQuickReply(preset.id, {
                              action: e.target.value as TelegramQuickReplyAction,
                            })
                          }
                          className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900">
                          <option value="reply">Send Custom Quick-Reply Message</option>
                          <option value="show_list">Show Live Products &amp; Rate List</option>
                          <option value="order_status">Show Customer Recent Order Status</option>
                          <option value="request_agent">Notify Admin &amp; Escalate to Agent</option>
                        </select>
                      </div>
                    </div>

                    <div>
                      <label className="block text-[11px] font-semibold text-slate-500 mb-1">
                        Quick-Reply Text Sent on Tap {preset.action === 'show_list' || preset.action === 'order_status' ? '(Optional intro)' : ''}
                      </label>
                      <textarea
                        rows={2}
                        maxLength={1000}
                        value={preset.replyText}
                        onChange={(e) =>
                          handleUpdateQuickReply(preset.id, {replyText: e.target.value})
                        }
                        placeholder="Message sent to customer when they tap this Telegram button..."
                        className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900"
                      />
                    </div>
                  </div>
                ))}

                {sysForm.telegramQuickReplies.length === 0 && (
                  <p className="text-xs text-slate-500 py-3">
                    No quick-reply presets configured. Add one below or restore defaults.
                  </p>
                )}
              </div>

              {/* Add New Quick-Reply Button */}
              <div className="p-3.5 rounded-lg border border-dashed border-slate-300 dark:border-slate-700 space-y-3">
                <p className="text-xs font-bold text-slate-700 dark:text-slate-300">
                  Add New Quick-Reply Button
                </p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <input
                    type="text"
                    maxLength={40}
                    value={newQuickLabel}
                    onChange={(e) => setNewQuickLabel(e.target.value)}
                    placeholder="Button label (e.g. Payment Received)"
                    className="px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                  />
                  <select
                    value={newQuickAction}
                    onChange={(e) => setNewQuickAction(e.target.value as TelegramQuickReplyAction)}
                    className="px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950">
                    <option value="reply">Send Custom Quick-Reply Message</option>
                    <option value="show_list">Show Live Products &amp; Rate List</option>
                    <option value="order_status">Show Customer Recent Order Status</option>
                    <option value="request_agent">Notify Admin &amp; Escalate to Agent</option>
                  </select>
                </div>
                <textarea
                  rows={2}
                  maxLength={1000}
                  value={newQuickReplyText}
                  onChange={(e) => setNewQuickReplyText(e.target.value)}
                  placeholder="Preset response text when tapped..."
                  className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                />
                <button
                  type="button"
                  onClick={handleAddQuickReply}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-white text-xs font-semibold cursor-pointer">
                  <Plus className="w-3.5 h-3.5" /> Add Preset Button
                </button>
              </div>

              {/* Telegram Inline Keyboard Live Preview */}
              {sysForm.telegramQuickRepliesEnabled &&
                sysForm.telegramQuickReplies.some((p) => p.active && p.label.trim()) && (
                  <div className="p-3.5 rounded-lg bg-slate-100 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 space-y-2">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                      Telegram Inline Keyboard Preview
                    </p>
                    <div className="max-w-sm grid grid-cols-2 gap-1.5">
                      {sysForm.telegramQuickReplies
                        .filter((p) => p.active && p.label.trim())
                        .map((p) => (
                          <div
                            key={p.id}
                            className="px-2.5 py-2 rounded-md bg-slate-800 text-white text-xs font-medium text-center truncate border border-slate-700">
                            {p.label}
                          </div>
                        ))}
                    </div>
                  </div>
                )}
            </div>

            <div className="pt-5 border-t border-slate-200 dark:border-slate-800 space-y-4">
              <div>
                <h2 className="text-base font-bold font-display flex items-center gap-2">
                  <Bot className="w-4 h-4 text-blue-600" /> Telegram Bot Full Admin Panel Access
                </h2>
                <p className="text-xs text-slate-600 dark:text-slate-400 mt-0.5">
                  Manage orders, verify payments, approve wallet deposits, reply to tickets, edit package prices, and toggle storefront notice directly inside Telegram via <code className="font-mono">/admin</code> or <code className="font-mono">/panel</code>. Message <code className="font-mono">/myid</code> to your bot in private DM to get your Telegram Chat ID, or unlock using <code className="font-mono">/admin &lt;password&gt;</code>.
                </p>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-start">
                <div>
                  <label className="block text-[11px] font-semibold text-slate-500 mb-1">
                    Authorized Admin Telegram Chat IDs (comma-separated)
                  </label>
                  <input
                    type="text"
                    value={sysForm.telegramAdminChatIdsInput}
                    onChange={(e) =>
                      setSysForm({...sysForm, telegramAdminChatIdsInput: e.target.value})
                    }
                    placeholder="e.g. 8139244263, 123456789"
                    className="w-full px-3 py-2 text-sm font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                  />
                  <span className="block text-[11px] text-slate-400 mt-1">
                    Also reads <code className="font-mono">ADMIN_TELEGRAM_CHAT_ID</code> env var if configured.
                  </span>
                </div>
                <div className="pt-1 md:pt-5 space-y-2">
                  <label className="flex items-center gap-2 text-xs font-semibold cursor-pointer">
                    <input
                      type="checkbox"
                      checked={sysForm.telegramAdminOrderAlerts}
                      onChange={(e) =>
                        setSysForm({...sysForm, telegramAdminOrderAlerts: e.target.checked})
                      }
                    />
                    Send Real-Time New Order, Deposit &amp; Ticket Alerts to Telegram Admins
                  </label>
                </div>
              </div>
            </div>

            <div className="pt-5 border-t border-slate-200 dark:border-slate-800 space-y-4">
              <div>
                <h2 className="text-base font-bold font-display flex items-center gap-2">
                  <Search className="w-4 h-4 text-emerald-600" /> Player IGN Live Checker &amp; Customer Reviews
                </h2>
                <p className="text-xs text-slate-600 dark:text-slate-400 mt-0.5">
                  Built-in Free Fire Shop2Game IGN checker &amp; Firestore UID cache run automatically. Optionally configure an external HTTPS player lookup endpoint (supports <code className="font-mono">{'{uid}'}</code>, <code className="font-mono">{'{game}'}</code>, <code className="font-mono">{'{server}'}</code> placeholders).
                </p>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-[11px] font-semibold text-slate-500 mb-1">
                    Custom Player IGN Lookup API URL (Optional HTTPS)
                  </label>
                  <input
                    type="url"
                    value={sysForm.playerLookupBaseUrl}
                    onChange={(e) =>
                      setSysForm({...sysForm, playerLookupBaseUrl: e.target.value})
                    }
                    placeholder="https://ign-api.example.com/check?game={game}&uid={uid}"
                    className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-slate-500 mb-1">
                    Custom Player Lookup API Key (Optional)
                  </label>
                  <input
                    type="password"
                    value={sysForm.playerLookupApiKey}
                    onChange={(e) =>
                      setSysForm({...sysForm, playerLookupApiKey: e.target.value})
                    }
                    placeholder={
                      sysForm.hasPlayerLookupApiKey ? '•••••••• (Saved on server)' : 'Bearer / X-API-Key token'
                    }
                    className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                  />
                </div>
              </div>
              <label className="flex items-center gap-2 text-xs font-semibold cursor-pointer">
                <input
                  type="checkbox"
                  checked={sysForm.autoApproveReviews}
                  onChange={(e) =>
                    setSysForm({...sysForm, autoApproveReviews: e.target.checked})
                  }
                />
                Auto-Approve New Customer Reviews Immediately (when unchecked, reviews require Web Admin or Telegram approval)
              </label>
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

            {autoStatus && (
              <div className="pt-5 border-t border-slate-200 dark:border-slate-800 space-y-3">
                <h2 className="text-base font-bold font-display flex items-center gap-2">
                  <Bot className="w-4 h-4 text-blue-600" /> Telegram Business Bot &amp; SMS Auto-Payment Status
                </h2>
                <p className="text-xs text-slate-600 dark:text-slate-400">
                  Configure <code className="font-mono">FIREBASE_SERVICE_ACCOUNT</code>,{' '}
                  <code className="font-mono">SMS_WEBHOOK_SECRET</code>,{' '}
                  <code className="font-mono">TELEGRAM_BOT_TOKEN</code>,{' '}
                  <code className="font-mono">BKASH_NUMBER</code>, and{' '}
                  <code className="font-mono">NAGAD_NUMBER</code> in your Render environment variables. SMS forwarder endpoint:{' '}
                  <code className="font-mono">POST /api/sms-webhook</code> (header <code className="font-mono">x-sms-secret</code>).
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
                  <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
                    <span className="text-slate-500 block">Firestore Admin SDK</span>
                    <span className={`font-bold ${autoStatus.firestoreConnected ? 'text-emerald-600' : 'text-amber-600'}`}>
                      {autoStatus.firestoreConnected
                        ? `Connected (${autoStatus.firebaseAdminMode})`
                        : 'Not Connected'}
                    </span>
                    <span className="block text-[11px] text-slate-400 truncate mt-0.5">
                      DB: {autoStatus.firestoreDatabaseId}
                    </span>
                  </div>
                  <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
                    <span className="text-slate-500 block">SMS Webhook Secret</span>
                    <span className={`font-bold ${autoStatus.smsWebhookConfigured ? 'text-emerald-600' : 'text-amber-600'}`}>
                      {autoStatus.smsWebhookConfigured ? 'Configured & Protected' : 'Missing SMS_WEBHOOK_SECRET'}
                    </span>
                    <span className="block text-[11px] text-slate-500 mt-1">
                      Mail:{' '}
                      <strong
                        className={
                          autoStatus.emailTransport === 'brevo'
                            ? 'text-emerald-600'
                            : autoStatus.emailTransport === 'smtp'
                              ? 'text-blue-600'
                              : 'text-amber-600'
                        }>
                        {autoStatus.emailTransport === 'brevo'
                          ? autoStatus.brevoSenderConfigured
                            ? 'Brevo REST API (HTTPS)'
                            : 'Brevo (Missing BREVO_SENDER_EMAIL)'
                          : autoStatus.emailTransport === 'smtp'
                            ? 'Nodemailer SMTP'
                            : 'Not Configured'}
                      </strong>
                    </span>
                  </div>
                  <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
                    <span className="text-slate-500 block">Telegram Business Bot</span>
                    <span className={`font-bold ${autoStatus.telegramBotRunning ? 'text-emerald-600' : 'text-amber-600'}`}>
                      {autoStatus.telegramBotRunning
                        ? `Active${autoStatus.telegramBotUsername ? ` (@${autoStatus.telegramBotUsername})` : ''}`
                        : 'Waiting for TELEGRAM_BOT_TOKEN'}
                    </span>
                    <span className="block text-[11px] text-slate-500 mt-0.5">
                      AI Mode:{' '}
                      <strong className={autoStatus.geminiConfigured ? 'text-emerald-600' : 'text-slate-500'}>
                        {autoStatus.geminiConfigured
                          ? `Gemini (${autoStatus.geminiModel || 'gemini-3.8-flash'})`
                          : 'Rule-based fallback'}
                      </strong>
                    </span>
                    {autoStatus.telegramBotRunning && (
                      <span className="block text-[11px] text-slate-400 mt-0.5">
                        Updates: {autoStatus.telegramBotProcessedUpdates} · Admin IDs:{' '}
                        {autoStatus.telegramAdminCount ?? 0}
                      </span>
                    )}
                    {autoStatus.telegramBotLastError && (
                      <span className="block text-[11px] text-red-500 truncate mt-0.5">
                        {autoStatus.telegramBotLastError}
                      </span>
                    )}
                  </div>
                  <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
                    <span className="text-slate-500 block">Bot Payment Numbers</span>
                    <span className="block font-mono text-[11px] mt-0.5">
                      bKash: {autoStatus.bkashNumberMasked || 'Fallback to Payment Methods'}
                    </span>
                    <span className="block font-mono text-[11px]">
                      Nagad: {autoStatus.nagadNumberMasked || 'Fallback to Payment Methods'}
                    </span>
                  </div>
                </div>
              </div>
            )}
          </form>

          {/* Commerce Rules, Loyalty, Fraud Guard & Merchant Payment Gateway */}
          <form
            onSubmit={handleSaveCommerceSettings}
            className="rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-6 space-y-6">
              <div className="space-y-4">
                <h2 className="text-base font-bold font-display flex items-center gap-2">
                  <Award className="w-4 h-4 text-amber-500" /> VIP Tiers, Loyalty Cashback &amp; Referral Program
                </h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-500 mb-1">
                      VIP Spend Threshold (৳)
                    </label>
                    <input
                      type="number"
                      min={100}
                      value={commerceForm.vipSpendThreshold}
                      onChange={(e) =>
                        setCommerceForm({...commerceForm, vipSpendThreshold: Number(e.target.value)})
                      }
                      className="w-full px-3 py-2 text-sm font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-500 mb-1">
                      VIP Discount (%)
                    </label>
                    <input
                      type="number"
                      min={0}
                      max={50}
                      step="0.5"
                      value={commerceForm.vipDiscountPercent}
                      onChange={(e) =>
                        setCommerceForm({...commerceForm, vipDiscountPercent: Number(e.target.value)})
                      }
                      className="w-full px-3 py-2 text-sm font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-500 mb-1">
                      Reseller Spend Threshold (৳)
                    </label>
                    <input
                      type="number"
                      min={500}
                      value={commerceForm.resellerSpendThreshold}
                      onChange={(e) =>
                        setCommerceForm({
                          ...commerceForm,
                          resellerSpendThreshold: Number(e.target.value),
                        })
                      }
                      className="w-full px-3 py-2 text-sm font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-500 mb-1">
                      Reseller Discount (%)
                    </label>
                    <input
                      type="number"
                      min={0}
                      max={60}
                      step="0.5"
                      value={commerceForm.resellerDiscountPercent}
                      onChange={(e) =>
                        setCommerceForm({
                          ...commerceForm,
                          resellerDiscountPercent: Number(e.target.value),
                        })
                      }
                      className="w-full px-3 py-2 text-sm font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-500 mb-1">
                      Referral Bonus Wallet Credit (৳)
                    </label>
                    <input
                      type="number"
                      min={0}
                      value={commerceForm.referralBonusAmount}
                      onChange={(e) =>
                        setCommerceForm({...commerceForm, referralBonusAmount: Number(e.target.value)})
                      }
                      className="w-full px-3 py-2 text-sm font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-500 mb-1">
                      Loyalty Cashback (% of paid order)
                    </label>
                    <input
                      type="number"
                      min={0}
                      max={25}
                      step="0.5"
                      value={commerceForm.loyaltyPercent}
                      onChange={(e) =>
                        setCommerceForm({...commerceForm, loyaltyPercent: Number(e.target.value)})
                      }
                      className="w-full px-3 py-2 text-sm font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-500 mb-1">
                      1 Point Value (৳)
                    </label>
                    <input
                      type="number"
                      min={0.1}
                      max={100}
                      step="0.1"
                      value={commerceForm.loyaltyPointValueBdt}
                      onChange={(e) =>
                        setCommerceForm({
                          ...commerceForm,
                          loyaltyPointValueBdt: Number(e.target.value),
                        })
                      }
                      className="w-full px-3 py-2 text-sm font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                    />
                  </div>
                </div>
              </div>

              <div className="pt-5 border-t border-slate-200 dark:border-slate-800 space-y-4">
                <h2 className="text-base font-bold font-display flex items-center gap-2">
                  <ShieldAlert className="w-4 h-4 text-rose-600" /> Fraud &amp; Velocity Guard Thresholds
                </h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-xl">
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-500 mb-1">
                      Max TrxID Attempts / Hour before Flag
                    </label>
                    <input
                      type="number"
                      min={1}
                      max={50}
                      value={commerceForm.fraudMaxFailedTrxPerHour}
                      onChange={(e) =>
                        setCommerceForm({
                          ...commerceForm,
                          fraudMaxFailedTrxPerHour: Number(e.target.value),
                        })
                      }
                      className="w-full px-3 py-2 text-sm font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-500 mb-1">
                      Max Burst Orders / 10 Min before Flag
                    </label>
                    <input
                      type="number"
                      min={1}
                      max={50}
                      value={commerceForm.fraudMaxOrdersPer10Min}
                      onChange={(e) =>
                        setCommerceForm({
                          ...commerceForm,
                          fraudMaxOrdersPer10Min: Number(e.target.value),
                        })
                      }
                      className="w-full px-3 py-2 text-sm font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                    />
                  </div>
                </div>
              </div>

              <div className="pt-5 border-t border-slate-200 dark:border-slate-800 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h2 className="text-base font-bold font-display flex items-center gap-2">
                    <CreditCard className="w-4 h-4 text-emerald-600" /> Automated Merchant Payment Gateway
                  </h2>
                  {commerceForm.gatewayEnabled &&
                    !commerceForm.hasGatewayApiKey &&
                    !commerceForm.gatewayApiKey && (
                      <span className="px-2.5 py-1 rounded bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300 text-[11px] font-bold">
                        Pending API Key Configuration
                      </span>
                    )}
                </div>
                <label className="flex items-center gap-2 text-xs font-semibold cursor-pointer">
                  <input
                    type="checkbox"
                    checked={commerceForm.gatewayEnabled}
                    onChange={(e) =>
                      setCommerceForm({...commerceForm, gatewayEnabled: e.target.checked})
                    }
                  />
                  Show Automated Gateway Pay Option on Checkout (requires Merchant API Key)
                </label>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-500 mb-1">
                      Gateway Provider
                    </label>
                    <select
                      value={commerceForm.gatewayProvider}
                      onChange={(e) =>
                        setCommerceForm({
                          ...commerceForm,
                          gatewayProvider: e.target.value as
                            | 'none'
                            | 'uddoktapay'
                            | 'sslcommerz'
                            | 'bkash_merchant'
                            | 'nagad_merchant',
                        })
                      }
                      className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950">
                      <option value="none">Disabled</option>
                      <option value="uddoktapay">UddoktaPay</option>
                      <option value="sslcommerz">SSLCommerz PGW</option>
                      <option value="bkash_merchant">bKash Merchant Checkout</option>
                      <option value="nagad_merchant">Nagad Merchant PGW</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-500 mb-1">
                      Gateway API Base URL
                    </label>
                    <input
                      type="url"
                      value={commerceForm.gatewayBaseUrl}
                      onChange={(e) =>
                        setCommerceForm({...commerceForm, gatewayBaseUrl: e.target.value})
                      }
                      placeholder="https://sandbox.uddoktapay.com"
                      className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-500 mb-1">
                      Merchant API Key
                    </label>
                    <input
                      type="password"
                      value={commerceForm.gatewayApiKey}
                      onChange={(e) =>
                        setCommerceForm({...commerceForm, gatewayApiKey: e.target.value})
                      }
                      placeholder={
                        commerceForm.hasGatewayApiKey ? '•••••••• (Saved on server)' : 'Paste merchant API key'
                      }
                      className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-500 mb-1">
                      Webhook Verification Secret
                    </label>
                    <input
                      type="password"
                      value={commerceForm.gatewayWebhookSecret}
                      onChange={(e) =>
                        setCommerceForm({...commerceForm, gatewayWebhookSecret: e.target.value})
                      }
                      placeholder={
                        commerceForm.hasGatewayWebhookSecret
                          ? '•••••••• (Saved on server)'
                          : 'Webhook HMAC / header secret'
                      }
                      className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                    />
                  </div>
                </div>

                {commerceForm.gatewayProvider === 'sslcommerz' && (
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    SSLCommerz Tip: Put your <strong>Store ID</strong> in Merchant API Key and your <strong>Store Password</strong> in Webhook Verification Secret. Leave Base URL blank for live (<code className="font-mono">securepay.sslcommerz.com</code>) or enter <code className="font-mono">https://sandbox.sslcommerz.com</code> for sandbox testing.
                  </p>
                )}

                {commerceForm.gatewayProvider !== 'none' && typeof window !== 'undefined' && (
                  <div className="flex flex-wrap items-center justify-between gap-2 p-3 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-xs">
                    <span className="font-mono text-slate-600 dark:text-slate-300 truncate">
                      Webhook IPN URL:{' '}
                      {`${window.location.origin}/api/payment-gateway/webhook/${commerceForm.gatewayProvider}`}
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        void navigator.clipboard.writeText(
                          `${window.location.origin}/api/payment-gateway/webhook/${commerceForm.gatewayProvider}`,
                        );
                        setCommerceMsg('Webhook URL copied to clipboard.');
                      }}
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded border border-slate-300 dark:border-slate-700 font-semibold cursor-pointer">
                      <Copy className="w-3 h-3" /> Copy URL
                    </button>
                  </div>
                )}
              </div>

              {commerceErr && <p className="text-xs text-red-600 font-medium">{commerceErr}</p>}
              {commerceMsg && <p className="text-xs text-emerald-600 font-medium">{commerceMsg}</p>}

              <button
                type="submit"
                disabled={savingCommerce}
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold cursor-pointer disabled:opacity-50">
                <Save className="w-3.5 h-3.5" /> {savingCommerce ? 'Saving...' : 'Save Commerce & Gateway Rules'}
              </button>
          </form>

          {/* Public Reseller / Developer API v1 Keys */}
          <div className="rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-6 space-y-5">
            <div>
              <h2 className="text-base font-bold font-display flex items-center gap-2">
                <Code2 className="w-4 h-4 text-blue-600" /> Public Reseller / Developer API Keys (<code className="font-mono text-sm">/api/v1/*</code>)
              </h2>
              <p className="text-xs text-slate-600 dark:text-slate-400 mt-0.5">
                Issue wallet-backed API keys (<code className="font-mono">mk_live_...</code>) so trusted resellers and partner bots can check catalog stock and place instant automated orders using their MUNAFTOPUP.bd wallet balance.
              </p>
            </div>

            <form onSubmit={handleIssueResellerKey} className="grid grid-cols-1 md:grid-cols-3 gap-3 items-end">
              <div>
                <label className="block text-[11px] font-semibold text-slate-500 mb-1">
                  Registered Customer Email *
                </label>
                <input
                  type="email"
                  required
                  value={newKeyEmail}
                  onChange={(e) => setNewKeyEmail(e.target.value)}
                  placeholder="reseller@example.com"
                  className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                />
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-slate-500 mb-1">
                  Integration Label
                </label>
                <input
                  type="text"
                  maxLength={80}
                  value={newKeyLabel}
                  onChange={(e) => setNewKeyLabel(e.target.value)}
                  placeholder="e.g. Partner TopUp Site"
                  className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                />
              </div>
              <button
                type="submit"
                disabled={issuingKey}
                className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold cursor-pointer disabled:opacity-50">
                <Plus className="w-3.5 h-3.5" /> {issuingKey ? 'Issuing Key...' : 'Generate API Key'}
              </button>
            </form>

            {revealedKey && (
              <div className="p-4 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-900 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-bold text-emerald-900 dark:text-emerald-200">
                    New API Key Created ({revealedKey.label} · {revealedKey.customerEmail}) — Copy Now!
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      void navigator.clipboard.writeText(revealedKey.rawKey);
                      setResellerMsg('Secret API key copied to clipboard.');
                    }}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold cursor-pointer">
                    <Copy className="w-3 h-3" /> Copy Key
                  </button>
                </div>
                <p className="font-mono text-xs break-all p-2.5 rounded bg-white dark:bg-slate-950 border border-emerald-200 dark:border-emerald-800 text-slate-900 dark:text-emerald-300 select-all">
                  {revealedKey.rawKey}
                </p>
              </div>
            )}

            {resellerErr && <p className="text-xs text-red-600 font-medium">{resellerErr}</p>}
            {resellerMsg && <p className="text-xs text-emerald-600 font-medium">{resellerMsg}</p>}

            <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-800 text-slate-500">
                  <tr>
                    <th className="px-3.5 py-2.5 font-medium">Label / Reseller</th>
                    <th className="px-3.5 py-2.5 font-medium">Key Prefix</th>
                    <th className="px-3.5 py-2.5 font-medium">Requests</th>
                    <th className="px-3.5 py-2.5 font-medium">Total Spent</th>
                    <th className="px-3.5 py-2.5 font-medium">Status</th>
                    <th className="px-3.5 py-2.5 font-medium text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {resellerKeys.map((k) => (
                    <tr key={k.id}>
                      <td className="px-3.5 py-2.5">
                        <p className="font-semibold text-slate-900 dark:text-white">{k.label}</p>
                        <p className="text-[11px] text-slate-500">{k.customerEmail}</p>
                      </td>
                      <td className="px-3.5 py-2.5 font-mono text-slate-600 dark:text-slate-300">
                        {k.keyPrefix}
                      </td>
                      <td className="px-3.5 py-2.5 font-mono tabular-nums">
                        {k.totalRequests.toLocaleString()}
                      </td>
                      <td className="px-3.5 py-2.5 font-mono tabular-nums font-semibold">
                        ৳{k.totalSpent.toLocaleString()}
                      </td>
                      <td className="px-3.5 py-2.5">
                        <button
                          type="button"
                          onClick={() => void handleToggleResellerKey(k)}
                          className={`px-2 py-0.5 rounded font-semibold cursor-pointer ${
                            k.active
                              ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-400'
                              : 'bg-slate-100 text-slate-500 dark:bg-slate-800'
                          }`}>
                          {k.active ? 'Active' : 'Paused'}
                        </button>
                      </td>
                      <td className="px-3.5 py-2.5 text-right">
                        <button
                          type="button"
                          onClick={() => void handleDeleteResellerKey(k.id)}
                          className="p-1 rounded text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40 cursor-pointer"
                          title="Revoke key">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </td>
                    </tr>
                  ))}
                  {resellerKeys.length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-3.5 py-6 text-center text-slate-500">
                        No reseller API keys issued yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <div className="p-3.5 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-[11px] space-y-1.5 text-slate-600 dark:text-slate-300">
              <p className="font-bold text-slate-800 dark:text-slate-200">
                Developer API v1 Endpoints (Header: <code className="font-mono">Authorization: Bearer mk_live_...</code>)
              </p>
              <p className="font-mono">GET /api/v1/products — Live catalog, packages &amp; instant PIN stock</p>
              <p className="font-mono">GET /api/v1/balance — Reseller tier, wallet balance &amp; points</p>
              <p className="font-mono">POST /api/v1/order — Body: {'{ productId, packageId, playerUid, serverId }'}</p>
              <p className="font-mono">GET /api/v1/order/:orderNumber — Order delivery status &amp; voucher code</p>
            </div>
          </div>
          </div>
        )}

        {/* Tab 4: Audit & Activity Logs */}
        {tab === 'logs' && (
          <div className="space-y-6">
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

            <div className="rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 overflow-hidden">
              <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800 font-bold text-sm">
                API Fulfillment, Gateway, PIN Vault &amp; Fraud Guard Logs
              </div>
              <div className="divide-y divide-slate-100 dark:divide-slate-800 max-h-[420px] overflow-y-auto">
                {apiLogs.map((log) => (
                  <div key={log.id} className="p-3.5 text-xs space-y-1">
                    <div className="flex flex-wrap items-center justify-between gap-2 font-semibold">
                      <span className="flex items-center gap-2">
                        <span className="px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800 uppercase text-[10px] font-bold">
                          {log.type}
                        </span>
                        <span className="font-mono">{log.orderNumber}</span>
                        <span
                          className={
                            log.status === 'success'
                              ? 'text-emerald-600'
                              : log.status === 'failed'
                                ? 'text-rose-600'
                                : 'text-amber-600'
                          }>
                          {log.status.toUpperCase()}
                          {log.httpStatus ? ` (${log.httpStatus})` : ''}
                        </span>
                      </span>
                      <span className="text-slate-500 tabular-nums">
                        {log.createdAtIso ? new Date(log.createdAtIso).toLocaleString() : ''}
                      </span>
                    </div>
                    <p className="text-slate-600 dark:text-slate-400">{log.message}</p>
                    {log.endpoint && (
                      <p className="text-[11px] font-mono text-slate-400 truncate">{log.endpoint}</p>
                    )}
                  </div>
                ))}
                {apiLogs.length === 0 && (
                  <p className="p-6 text-center text-xs text-slate-500">
                    No API fulfillment or fraud guard events logged yet.
                  </p>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </AdminLayout>
  );
}
