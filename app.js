        import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js';
        import { getDatabase, ref, push, onValue, remove, set, get } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js';

        // ================================
        // 🔐 الأمان والتشفير
        // ================================
        const ADMIN_PASSWORD_HASH = '2d462887d1efd37fa48847db37d573d721756f8719b3564ef38272729b01c77a';
        const APP_VERSION = '1.15.0';
        
        async function hashPassword(password) {
            const msgBuffer = new TextEncoder().encode(password);
            const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
            const hashArray = Array.from(new Uint8Array(hashBuffer));
            return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
        }

        // ================================
        // 💾 متغيرات عامة
        // ================================
        let app = null;
        let db = null;
        let isFirebaseSetup = false;
        let currentUser = null;
        let allUsers = {};
        let allExpenses = {};
        let allLoans = {};
        let allRegistrationRequests = {};
        let allSettlementPayments = {};
        let allDirectSettlementPayments = {};
        let allPotContributions = {};
        let allPotSpending = {};
        let allArchive = {};
        let currentGroupCode = null; // كود الجروب الحالي

        window.hashPassword = hashPassword;

        // ================================
        // 🚀 التهيئة
        // ================================
        // ================================
        // 🔙 ربط زر الرجوع (موبايل/متصفح) بإغلاق أي مودال أو صفحة فرعية مفتوحة
        // بدل ما يخرج من التطبيق بالكامل
        // ================================
        (function setupBackButtonHandling() {
            let overlayHistoryPushed = false;

            function isAccountsSubpageOpen() {
                const el = document.querySelector('.app-page.active');
                return !!(el && (el.id === 'page-add' || el.id === 'page-accounts-dashboard'));
            }

            function isAnyOverlayOpen() {
                if (document.querySelector('.modal.active')) return true;
                const subpage = document.getElementById('subpage-overlay');
                if (subpage && subpage.style.display !== 'none') return true;
                if (isAccountsSubpageOpen()) return true;
                return false;
            }

            function syncHistoryState() {
                const open = isAnyOverlayOpen();
                if (open && !overlayHistoryPushed) {
                    history.pushState({ overlay: true }, '');
                    overlayHistoryPushed = true;
                } else if (!open && overlayHistoryPushed) {
                    overlayHistoryPushed = false;
                }
            }

            window.addEventListener('DOMContentLoaded', () => {
                const observer = new MutationObserver(syncHistoryState);
                observer.observe(document.body, { attributes: true, attributeFilter: ['class', 'style'], subtree: true });
            });

            window.addEventListener('popstate', () => {
                const modalOrSubpageOpen = document.querySelector('.modal.active') ||
                    (document.getElementById('subpage-overlay') && document.getElementById('subpage-overlay').style.display !== 'none');

                if (modalOrSubpageOpen) {
                    document.querySelectorAll('.modal.active').forEach(m => m.classList.remove('active'));
                    const subpage = document.getElementById('subpage-overlay');
                    if (subpage && subpage.style.display !== 'none') {
                        subpage.style.display = 'none';
                        const content = document.getElementById('subpage-content');
                        if (content) content.innerHTML = '';
                    }
                    overlayHistoryPushed = false;
                } else if (isAccountsSubpageOpen()) {
                    switchPage('page-accounts');
                    overlayHistoryPushed = false;
                }
            });

            // تستخدمها أي دالة إغلاق يدوية (زي زرار الرجوع الداخلي) عشان تنضّف سجل المتصفح
            window.__consumeOverlayHistory = function() {
                if (overlayHistoryPushed) {
                    overlayHistoryPushed = false;
                    history.back();
                }
            };
        })();

        // زر الرجوع اليدوي من صفحتي "إضافة" و"لوحة الحسابات" لقائمة تاب الحسابات
        window.goBackFromAccountsSubpage = function() {
            switchPage('page-accounts');
            if (window.__consumeOverlayHistory) window.__consumeOverlayHistory();
        };

        window.addEventListener('DOMContentLoaded', async function() {
            // أُظهر شاشة الجروب أولاً دائماً
            showGroupScreen();
            // بعدين حمّل Firebase وابدأ
            await loadFirebaseConfigFromStorage();
            restoreSectionsState();
            document.getElementById('expense-date').valueAsDate = new Date();

            // إخفاء شاشة البداية بعد اكتمال التحميل
            const splash = document.getElementById('splash-screen');
            if (splash) {
                setTimeout(() => splash.classList.add('hidden'), 300);
                setTimeout(() => splash.remove(), 800);
            }

            const versionLabel = document.getElementById('app-version-label');
            if (versionLabel) versionLabel.textContent = APP_VERSION;
        });

        // ================================
        // ⚙️ Firebase Config
        // ================================
        // Firebase Config الثابت (يمكن تغييره من الواجهة)
        const DEFAULT_FIREBASE_CONFIG = {
            apiKey: "AIzaSyDjw6I28ThtT4sxStXdOUM4ftXlccK5FJU",
            authDomain: "expenses-c4791.firebaseapp.com",
            databaseURL: "https://expenses-c4791-default-rtdb.firebaseio.com",
            projectId: "expenses-c4791",
            storageBucket: "expenses-c4791.firebasestorage.app",
            messagingSenderId: "753807744189",
            appId: "1:753807744189:web:10c4cef3a6ffb61d036bd4",
            measurementId: "G-LFM0K5MHZ4"
        };
        
        const DEFAULT_ADMIN_NAME = "على";
        let adminName = DEFAULT_ADMIN_NAME;
        window.adminName = adminName;

        async function loadFirebaseConfigFromStorage() {
            try {
                let storedConfig = null;
                let storedAdminName = null;
                
                // محاولة التحميل من persistent storage أولاً
                try {
                    if (window.storage) {
                        const configResult = await window.storage.get('firebase-config');
                        const nameResult = await window.storage.get('admin-name');
                        
                        if (configResult && configResult.value) {
                            storedConfig = JSON.parse(configResult.value);
                        }
                        if (nameResult && nameResult.value) {
                            storedAdminName = nameResult.value;
                        }
                    }
                } catch (storageError) {
                    console.log('Persistent storage not available, using localStorage');
                }
                
                // Fallback إلى localStorage
                if (!storedConfig) {
                    const localConfig = localStorage.getItem('firebase-config');
                    if (localConfig) {
                        storedConfig = JSON.parse(localConfig);
                    }
                }
                
                if (!storedAdminName) {
                    storedAdminName = localStorage.getItem('admin-name');
                }
                
                // تعيين اسم Admin
                if (storedAdminName) {
                    adminName = storedAdminName;
                    window.adminName = adminName;
                }
                document.getElementById('config-adminName').value = adminName;
                
                // تهيئة Firebase
                const configToUse = storedConfig || DEFAULT_FIREBASE_CONFIG;
                await initializeFirebaseWithConfig(configToUse);
                
                // تعبئة النموذج
                document.getElementById('config-apiKey').value = configToUse.apiKey;
                document.getElementById('config-authDomain').value = configToUse.authDomain;
                document.getElementById('config-databaseURL').value = configToUse.databaseURL;
                document.getElementById('config-projectId').value = configToUse.projectId;
                document.getElementById('config-storageBucket').value = configToUse.storageBucket;
                document.getElementById('config-messagingSenderId').value = configToUse.messagingSenderId;
                document.getElementById('config-appId').value = configToUse.appId;
                
            } catch (error) {
                // في حالة فشل كل شيء، استخدم Config الثابت
                console.log('Using default config', error);
                adminName = DEFAULT_ADMIN_NAME;
                window.adminName = adminName;
                initializeFirebaseWithConfig(DEFAULT_FIREBASE_CONFIG);
                document.getElementById('config-adminName').value = DEFAULT_ADMIN_NAME;
                
                // تعبئة النموذج بالقيم الافتراضية
                document.getElementById('config-apiKey').value = DEFAULT_FIREBASE_CONFIG.apiKey;
                document.getElementById('config-authDomain').value = DEFAULT_FIREBASE_CONFIG.authDomain;
                document.getElementById('config-databaseURL').value = DEFAULT_FIREBASE_CONFIG.databaseURL;
                document.getElementById('config-projectId').value = DEFAULT_FIREBASE_CONFIG.projectId;
                document.getElementById('config-storageBucket').value = DEFAULT_FIREBASE_CONFIG.storageBucket;
                document.getElementById('config-messagingSenderId').value = DEFAULT_FIREBASE_CONFIG.messagingSenderId;
                document.getElementById('config-appId').value = DEFAULT_FIREBASE_CONFIG.appId;
            }
        }

        window.saveFirebaseConfig = async function(event) {
            event.preventDefault();
            
            if (!currentUser || currentUser.passwordHash !== ADMIN_PASSWORD_HASH) {
                showAlert('❌ إعدادات Firebase متاحة للمشرف الرئيسي فقط', 'danger');
                return;
            }
            
            const adminName = document.getElementById('config-adminName').value.trim();
            
            const config = {
                apiKey: document.getElementById('config-apiKey').value,
                authDomain: document.getElementById('config-authDomain').value,
                databaseURL: document.getElementById('config-databaseURL').value,
                projectId: document.getElementById('config-projectId').value,
                storageBucket: document.getElementById('config-storageBucket').value,
                messagingSenderId: document.getElementById('config-messagingSenderId').value,
                appId: document.getElementById('config-appId').value
            };

            try {
                // محاولة الحفظ في persistent storage
                try {
                    if (window.storage) {
                        await window.storage.set('firebase-config', JSON.stringify(config));
                        await window.storage.set('admin-name', adminName);
                    } else {
                        throw new Error('Storage not available');
                    }
                } catch (storageError) {
                    // Fallback إلى localStorage
                    console.log('Using localStorage fallback');
                    localStorage.setItem('firebase-config', JSON.stringify(config));
                    localStorage.setItem('admin-name', adminName);
                }
                
                // تحديث المتغير العام
                window.adminName = adminName;
                
                // تهيئة Firebase
                initializeFirebaseWithConfig(config);
                
                // تحديث اسم Admin في Firebase إذا كان مسجل دخول
                if (currentUser && currentUser.role === 'admin') {
                    currentUser.name = adminName;
                    localStorage.setItem('currentUser', JSON.stringify(currentUser));
                    
                    if (db) {
                        const adminRef = ref(db, 'users/admin');
                        await set(adminRef, {
                            name: adminName,
                            role: 'admin',
                            passwordHash: currentUser.passwordHash
                        });
                    }
                    
                    applyUserRole();
                }
                
                showAlert('تم حفظ الإعدادات بنجاح! 🎉', 'success');
                closeFirebaseConfigModal();
            } catch (error) {
                console.error('Error saving config:', error);
                showAlert('حدث خطأ في حفظ الإعدادات: ' + error.message, 'danger');
            }
        };

        function initializeFirebaseWithConfig(config) {
            try {
                if (app) return Promise.resolve();
                
                app = initializeApp(config);
                db = getDatabase(app);
                isFirebaseSetup = true;
                
                document.getElementById('connection-status').textContent = 'متصل';
                document.getElementById('firebase-status').style.background = 'rgba(16, 185, 129, 0.1)';
                document.getElementById('firebase-status').style.borderColor = 'var(--accent-success)';
                document.getElementById('firebase-status').style.color = 'var(--accent-success)';
                
                document.getElementById('config-status').style.background = 'rgba(16, 185, 129, 0.1)';
                document.getElementById('config-status').style.color = 'var(--accent-success)';
                document.getElementById('config-status').textContent = '✅ متصل بـ Firebase';
                
                // Migration أولاً ثم تحقق من الجروب المحفوظ
                return migrateOldData().then(() => {
                    const savedGroupCode = localStorage.getItem('currentGroupCode');
                    if (savedGroupCode) {
                        currentGroupCode = savedGroupCode;
                        listenToData();
                    }
                    checkLoginStatus();
                });

            } catch (error) {
                console.error('Firebase error:', error);
                showAlert('فشل الاتصال بـ Firebase', 'danger');
                return Promise.resolve();
            }
        }

        function groupPath(sub) {
            return `groups/${currentGroupCode}/${sub}`;
        }

        function listenToData() {
            if (!db || !currentGroupCode) return;

            // الاستماع للمستخدمين
            onValue(ref(db, groupPath('users')), (snapshot) => {
                allUsers = snapshot.val() || {};
                updateParticipantsCheckboxes();
                const usersModal = document.getElementById('users-modal');
                if (usersModal && usersModal.classList.contains('active')) {
                    updateUsersModalList();
                }
            });

            // الاستماع للمصاريف
            let expensesFirstLoad = true;
            let knownExpenseIds = new Set();
            onValue(ref(db, groupPath('expenses')), (snapshot) => {
                allExpenses = snapshot.val() || {};
                const currentIds = Object.keys(allExpenses);
                if (expensesFirstLoad) {
                    knownExpenseIds = new Set(currentIds);
                    expensesFirstLoad = false;
                } else {
                    currentIds.forEach(id => {
                        if (!knownExpenseIds.has(id)) {
                            const exp = allExpenses[id];
                            if (exp.paidBy !== currentUser?.id) {
                                const payerName = allUsers[exp.paidBy]?.name || 'أحد الأعضاء';
                                showAlert(`💳 ${payerName} أضاف مصروف: ${exp.description || ''} (${parseFloat(exp.amount).toFixed(2)} ج.م)`, 'success');
                            }
                            knownExpenseIds.add(id);
                        }
                    });
                    knownExpenseIds = new Set(currentIds);
                }
                updateDashboard();
                updateSettlementsDashboard();
                updateExpensesLog();
                updateStats();
            });

            // الاستماع لطلبات التسجيل
            onValue(ref(db, groupPath('registration_requests')), (snapshot) => {
                allRegistrationRequests = snapshot.val() || {};
                updateRegistrationRequestsBadge();
            });

            // الاستماع لدفعات التسوية (تأكيد الدفع + الدفعات الجزئية)
            onValue(ref(db, groupPath('settlementPayments')), (snapshot) => {
                allSettlementPayments = snapshot.val() || {};
                updateSettlementsDashboard();
            });
            onValue(ref(db, groupPath('directSettlementPayments')), (snapshot) => {
                allDirectSettlementPayments = snapshot.val() || {};
                updateSettlementsDashboard();
            });

            // الاستماع للكشة المشتركة
            onValue(ref(db, groupPath('pot/contributions')), (snapshot) => {
                allPotContributions = snapshot.val() || {};
                updatePotDashboard();
            });
            onValue(ref(db, groupPath('pot/spending')), (snapshot) => {
                allPotSpending = snapshot.val() || {};
                updatePotDashboard();
            });

            // الاستماع للأرشيف
            onValue(ref(db, groupPath('archive')), (snapshot) => {
                allArchive = snapshot.val() || {};
            });
        }

        // ================================
        // 🏠 نظام الجروبات
        // ================================
        const DEFAULT_GROUP_CODE = '201010';
        const ALT_GROUP_CODE = '221010'; // كود بديل مقبول
        const DEFAULT_GROUP_NAME = 'مصاريف السكن';
        const MAX_LOGIN_ATTEMPTS = 5;
        const LOCKOUT_DURATION_MS = 5 * 60 * 1000; // 5 دقايق

        // تحقق هل الجروب مقفول مؤقتًا بسبب محاولات فاشلة كتير
        async function checkLoginLockout(code) {
            try {
                const snap = await get(ref(db, `groups/${code}/security/loginAttempts`));
                const data = snap.val();
                if (!data || !data.count) return { locked: false };

                const elapsed = Date.now() - (data.lastAttempt || 0);
                if (data.count >= MAX_LOGIN_ATTEMPTS && elapsed < LOCKOUT_DURATION_MS) {
                    const remainingMin = Math.ceil((LOCKOUT_DURATION_MS - elapsed) / 60000);
                    return { locked: true, remainingMin };
                }
                return { locked: false };
            } catch {
                return { locked: false };
            }
        }

        // تسجيل محاولة دخول فاشلة
        async function recordFailedLoginAttempt(code) {
            try {
                const snap = await get(ref(db, `groups/${code}/security/loginAttempts`));
                const data = snap.val() || { count: 0 };
                const elapsed = Date.now() - (data.lastAttempt || 0);
                // لو آخر محاولة كانت قبل مدة القفل بكتير، ابدأ العداد من جديد
                const newCount = elapsed > LOCKOUT_DURATION_MS ? 1 : (data.count || 0) + 1;
                await set(ref(db, `groups/${code}/security/loginAttempts`), {
                    count: newCount,
                    lastAttempt: Date.now()
                });
            } catch (e) {
                console.error('Could not record login attempt', e);
            }
        }

        // تصفير عداد المحاولات بعد دخول ناجح
        async function resetLoginAttempts(code) {
            try {
                await set(ref(db, `groups/${code}/security/loginAttempts`), null);
            } catch (e) {
                console.error('Could not reset login attempts', e);
            }
        }

        // ================================
        // 🎨 لون ثابت لكل شخص + أفاتار
        // ================================
        const PERSON_PALETTE = [
            { bg: '#6366f1', glow: 'rgba(99,102,241,.4)'  },
            { bg: '#f59e0b', glow: 'rgba(245,158,11,.4)'  },
            { bg: '#10b981', glow: 'rgba(16,185,129,.4)'  },
            { bg: '#ec4899', glow: 'rgba(236,72,153,.4)'  },
            { bg: '#06b6d4', glow: 'rgba(6,182,212,.4)'   },
            { bg: '#8b5cf6', glow: 'rgba(139,92,246,.4)'  },
            { bg: '#ef4444', glow: 'rgba(239,68,68,.4)'   },
            { bg: '#84cc16', glow: 'rgba(132,204,22,.4)'  },
            { bg: '#f97316', glow: 'rgba(249,115,22,.4)'  },
            { bg: '#14b8a6', glow: 'rgba(20,184,166,.4)'  }
        ];

        function getPersonColor(userId) {
            const str = String(userId || 'x');
            let hash = 0;
            for (let i = 0; i < str.length; i++) {
                hash = (hash * 31 + str.charCodeAt(i)) >>> 0;
            }
            return PERSON_PALETTE[hash % PERSON_PALETTE.length];
        }

        // بيرجع HTML لدايرة أفاتار بلون ثابت حسب هوية الشخص
        function avatarHtml(userId, name, sizePx) {
            const color = getPersonColor(userId);
            const initial = (name || '؟').trim().charAt(0).toUpperCase();
            const size = sizePx || 40;
            const font = Math.round(size * 0.42);
            return `<span class="avatar-circle" style="width:${size}px;height:${size}px;font-size:${font}px;background:${color.bg};box-shadow:0 3px 10px ${color.glow};">${initial}</span>`;
        }

        // ================================
        // 📈 رسوم بيانية حقيقية (SVG بدون مكتبات خارجية)
        // ================================
        const CATEGORY_ICONS = {
            food: '🍔', transport: '🚗', entertainment: '🎬',
            utilities: '💡', shopping: '🛍️', health: '⚕️', other: '📦'
        };
        const CATEGORY_NAMES = {
            food: 'طعام', transport: 'مواصلات', entertainment: 'ترفيه',
            utilities: 'فواتير', shopping: 'تسوق', health: 'صحة', other: 'أخرى'
        };
        const CATEGORY_COLORS = {
            food: '#f59e0b', transport: '#06b6d4', entertainment: '#ec4899',
            utilities: '#8b5cf6', shopping: '#10b981', health: '#ef4444', other: '#94a3b8'
        };

        function renderCharts() {
            renderCategoryChart();
            renderPayerChart();
        }

        function renderCategoryChart() {
            const wrap = document.getElementById('category-chart-wrap');
            if (!wrap) return;

            const totals = {};
            let grandTotal = 0;
            Object.values(allExpenses).forEach(exp => {
                const cat = exp.category || 'other';
                const amt = parseFloat(exp.amount) || 0;
                totals[cat] = (totals[cat] || 0) + amt;
                grandTotal += amt;
            });

            if (grandTotal === 0) {
                wrap.innerHTML = `<div style="text-align:center; padding:20px; color:var(--text-muted); font-size:13px;">هيظهر هنا توزيع مصاريفك حسب الفئة أول ما تسجل مصروف</div>`;
                return;
            }

            const cats = Object.keys(totals).sort((a, b) => totals[b] - totals[a]);
            const R = 46, CIRC = 2 * Math.PI * R;
            let offset = 0;
            let segments = '';
            cats.forEach(cat => {
                const pct = totals[cat] / grandTotal;
                const len = pct * CIRC;
                segments += `<circle class="donut-seg" cx="60" cy="60" r="${R}" fill="none" stroke="${CATEGORY_COLORS[cat] || '#94a3b8'}" stroke-width="16" stroke-dasharray="${len} ${CIRC - len}" stroke-dashoffset="${-offset}"></circle>`;
                offset += len;
            });

            const legend = cats.map(cat => {
                const pct = Math.round((totals[cat] / grandTotal) * 100);
                return `<div class="donut-legend-item">
                    <span class="donut-legend-dot" style="background:${CATEGORY_COLORS[cat] || '#94a3b8'}"></span>
                    <span class="donut-legend-label">${CATEGORY_ICONS[cat] || '📦'} ${CATEGORY_NAMES[cat] || cat}</span>
                    <span class="donut-legend-value">${pct}%</span>
                </div>`;
            }).join('');

            wrap.innerHTML = `
                <div class="donut-wrap">
                    <svg class="donut-svg" width="120" height="120" viewBox="0 0 120 120" style="transform: rotate(-90deg); flex-shrink:0;">
                        ${segments}
                    </svg>
                    <div class="donut-legend">${legend}</div>
                </div>
            `;
        }

        function renderPayerChart() {
            const wrap = document.getElementById('payer-chart-wrap');
            if (!wrap) return;

            const totals = {};
            Object.values(allExpenses).forEach(exp => {
                if (exp.fromPot) return;
                const amt = parseFloat(exp.amount) || 0;
                if (!exp.paidBy) return;
                totals[exp.paidBy] = (totals[exp.paidBy] || 0) + amt;
            });

            const userIds = Object.keys(totals).sort((a, b) => totals[b] - totals[a]);

            if (userIds.length === 0) {
                wrap.innerHTML = `<div style="text-align:center; padding:20px; color:var(--text-muted); font-size:13px;">هيظهر هنا مين دفع أكتر أول ما تسجل مصروف</div>`;
                return;
            }

            const max = totals[userIds[0]] || 1;

            wrap.innerHTML = `<div class="bar-chart">${userIds.map(uid => {
                const name = allUsers[uid]?.name || 'غير معروف';
                const color = getPersonColor(uid);
                const pct = Math.max(6, Math.round((totals[uid] / max) * 100));
                return `
                    <div class="bar-row">
                        ${avatarHtml(uid, name, 28)}
                        <div class="bar-track"><div class="bar-fill" style="width:${pct}%; background:${color.bg};"></div></div>
                        <div style="font-size:12px; font-weight:700; color:var(--text-secondary); min-width:60px; text-align:left;">${totals[uid].toFixed(0)} ج.م</div>
                    </div>
                `;
            }).join('')}</div>`;
        }

        function showGroupScreen() {
            document.getElementById('group-screen').style.display = 'flex';
            document.getElementById('login-screen').style.display = 'none';
            document.getElementById('main-content').style.display = 'none';
        }

        function showLoginScreen(groupName) {
            // نفس شاشة الجروب — مش محتاجين شاشة منفصلة
            showGroupScreen();
        }

        window.backToGroupScreen = function() {
            currentGroupCode = null;
            localStorage.removeItem('currentGroupCode');
            localStorage.removeItem('currentUser');
            currentUser = null;
            document.getElementById('group-code-input').value = '';
            document.getElementById('login-password').value = '';
            showGroupScreen();
        };

        window.loginWithGroup = async function(event) {
            event.preventDefault();
            
            if (!isFirebaseSetup || !db) {
                showAlert('جاري الاتصال... حاول مرة أخرى', 'warning');
                return;
            }

            let code = document.getElementById('group-code-input').value.trim();
            const password = document.getElementById('login-password').value;

            if (!code || !password) return;

            try {
                // تحقق من وجود الجروب — لو مش موجود جرّب migration
                let groupSnap = await get(ref(db, `groups/${code}/info`));
                
                if (!groupSnap.exists()) {
                    // لو الكود هو الكود الافتراضي أو البديل، اعمل migration أولاً
                    if (code === DEFAULT_GROUP_CODE || code === ALT_GROUP_CODE) {
                        showAlert('🔄 جاري تجهيز المجموعة...', 'info');
                        await migrateOldData();
                        // جرّب الكود الافتراضي لو الكود البديل مكنش موجود
                        groupSnap = await get(ref(db, `groups/${DEFAULT_GROUP_CODE}/info`));
                        if (groupSnap.exists()) {
                            // عدّل الكود للافتراضي فعليًا مش بس في الحقل
                            code = DEFAULT_GROUP_CODE;
                            document.getElementById('group-code-input').value = DEFAULT_GROUP_CODE;
                        }
                    }
                    
                    if (!groupSnap.exists()) {
                        showAlert('❌ كود المجموعة غير صحيح', 'danger');
                        return;
                    }
                }

                // تحقق هل المجموعة مقفولة مؤقتًا بسبب محاولات فاشلة كتير
                const lockStatus = await checkLoginLockout(code);
                if (lockStatus.locked) {
                    showAlert(`🔒 محاولات كتير غلط. حاول تاني بعد ${lockStatus.remainingMin} دقيقة`, 'danger');
                    return;
                }

                // تحقق من الرقم السري
                const passwordHash = await hashPassword(password);
                const usersSnap = await get(ref(db, `groups/${code}/users`));
                const users = usersSnap.val() || {};

                let found = null;

                // أولاً: دوّر في مستخدمي الجروب اللي دخلت بيه
                for (const userId in users) {
                    if (users[userId].passwordHash === passwordHash) {
                        found = { id: userId, ...users[userId] };
                        break;
                    }
                }

                // ثانياً: لو مفيش — دوّر في البيانات القديمة (قبل نظام الجروبات)
                // بيشمل أي مستخدم قديم، مش بس الأدمن اللي رقمه السري معروف
                if (!found && (code === DEFAULT_GROUP_CODE || code === ALT_GROUP_CODE)) {
                    const oldUsersSnap = await get(ref(db, 'users'));
                    const oldUsers = oldUsersSnap.val() || {};
                    for (const userId in oldUsers) {
                        if (oldUsers[userId].passwordHash === passwordHash) {
                            found = { id: userId, ...oldUsers[userId] };
                            break;
                        }
                    }

                    // لو لسه مفيش ولقيت الرقم السري بتاع الأدمن الافتراضي
                    if (!found && passwordHash === ADMIN_PASSWORD_HASH) {
                        found = {
                            id: 'admin',
                            name: 'على',
                            role: 'admin',
                            passwordHash: passwordHash
                        };
                    }

                    // لو اتلاقى حد بأي طريقة من البيانات القديمة، تأكد إن النقل تم
                    if (found) {
                        await migrateOldData();
                        // أضف/حدّث المستخدم في الجروب الحالي لو مش موجود فيه أصلاً
                        await set(ref(db, `groups/${DEFAULT_GROUP_CODE}/users/${found.id}`), {
                            name: found.name,
                            role: found.role || 'user',
                            passwordHash: found.passwordHash
                        });
                    }
                }

                if (!found) {
                    await recordFailedLoginAttempt(code);
                    showAlert('❌ الرقم السري غير صحيح', 'danger');
                    document.getElementById('login-password').value = '';
                    return;
                }

                // دخول ناجح
                await resetLoginAttempts(code);
                currentGroupCode = code;
                localStorage.setItem('currentGroupCode', code);
                currentUser = {
                    id: found.id,
                    name: found.name,
                    role: found.role || 'user',
                    passwordHash: passwordHash
                };
                localStorage.setItem('currentUser', JSON.stringify(currentUser));
                applyUserRole();
                showAlert(`مرحباً ${found.name}! ${found.role === 'admin' ? '👑' : '👋'}`, 'success');

            } catch (error) {
                showAlert('حدث خطأ: ' + error.message, 'danger');
            }
        };

        window.loginUser = window.loginWithGroup;
        window.enterGroup = window.loginWithGroup;

        window.openCreateGroupModal = function() {
            document.getElementById('create-group-modal').classList.add('active');
        };

        window.closeCreateGroupModal = function() {
            document.getElementById('create-group-modal').classList.remove('active');
        };

        window.createGroup = async function(event) {
            event.preventDefault();
            const groupName = document.getElementById('new-group-name').value.trim();
            const groupCode = document.getElementById('new-group-code').value.trim();
            const adminName = document.getElementById('new-group-admin-name').value.trim();
            const adminPass = document.getElementById('new-group-admin-pass').value;

            if (!db) {
                showAlert('يرجى إعداد Firebase أولاً', 'warning');
                return;
            }

            try {
                // تحقق إن الكود مش مستخدم
                const existing = await get(ref(db, `groups/${groupCode}/info`));
                if (existing.exists()) {
                    showAlert('❌ هذا الكود مستخدم بالفعل، اختر كوداً آخر', 'danger');
                    return;
                }

                const passwordHash = await hashPassword(adminPass);
                const adminId = 'admin_' + Date.now();

                // إنشاء الجروب
                await set(ref(db, `groups/${groupCode}/info`), {
                    name: groupName,
                    code: groupCode,
                    createdAt: Date.now()
                });

                // إنشاء مستخدم الأدمن
                await set(ref(db, `groups/${groupCode}/users/${adminId}`), {
                    name: adminName,
                    role: 'admin',
                    passwordHash: passwordHash
                });

                closeCreateGroupModal();
                showAlert(`✅ تم إنشاء "${groupName}" بنجاح! الكود: ${groupCode}`, 'success');

                // دخول الجروب الجديد
                currentGroupCode = groupCode;
                localStorage.setItem('currentGroupCode', groupCode);
                showLoginScreen(groupName);

            } catch (error) {
                showAlert('حدث خطأ: ' + error.message, 'danger');
            }
        };

        // Migration: نقل البيانات القديمة للجروب الافتراضي
        async function migrateOldData() {
            if (!db) return;

            try {
                // تحقق لو في بيانات قديمة على المستوى الأعلى (النسخة القديمة قبل نظام الجروبات)
                const oldUsers = await get(ref(db, 'users'));

                // تحقق لو الجروب الافتراضي موجود بالفعل
                const groupInfoSnap = await get(ref(db, `groups/${DEFAULT_GROUP_CODE}/info`));

                if (!groupInfoSnap.exists()) {
                    // مفيش جروب افتراضي أصلاً - أنشئه
                    await set(ref(db, `groups/${DEFAULT_GROUP_CODE}/info`), {
                        name: DEFAULT_GROUP_NAME,
                        code: DEFAULT_GROUP_CODE,
                        createdAt: Date.now()
                    });
                }

                if (!oldUsers.exists()) {
                    // مفيش بيانات قديمة للنقل
                    return;
                }

                // تحقق لو المستخدمين اتنقلوا فعلاً للجروب (مش بس اتفحص وجود الجروب)
                const groupUsersSnap = await get(ref(db, `groups/${DEFAULT_GROUP_CODE}/users`));
                if (groupUsersSnap.exists()) {
                    // البيانات موجودة بالفعل في الجروب - مفيش داعي للنقل تاني
                    return;
                }

                console.log('🔄 جاري نقل البيانات القديمة...');

                // نقل البيانات (حتى لو الجروب اتعمل قبل كده فاضي)
                const [usersSnap, expensesSnap, archiveSnap, reqSnap] = await Promise.all([
                    Promise.resolve(oldUsers),
                    get(ref(db, 'expenses')),
                    get(ref(db, 'archive')),
                    get(ref(db, 'registration_requests'))
                ]);

                const ops = [];
                if (usersSnap.exists()) ops.push(set(ref(db, `groups/${DEFAULT_GROUP_CODE}/users`), usersSnap.val()));
                if (expensesSnap.exists()) ops.push(set(ref(db, `groups/${DEFAULT_GROUP_CODE}/expenses`), expensesSnap.val()));
                if (archiveSnap.exists()) ops.push(set(ref(db, `groups/${DEFAULT_GROUP_CODE}/archive`), archiveSnap.val()));
                if (reqSnap.exists()) ops.push(set(ref(db, `groups/${DEFAULT_GROUP_CODE}/registration_requests`), reqSnap.val()));
                ops.push(set(ref(db, `groups/${DEFAULT_GROUP_CODE}/info/migratedAt`), Date.now()));

                await Promise.all(ops);
                console.log('✅ تم نقل البيانات بنجاح');

            } catch (error) {
                console.error('Migration error:', error);
            }
        }

        // ================================
        // 🔐 نظام تسجيل الدخول
        // ================================
        function checkLoginStatus() {
            const savedGroupCode = localStorage.getItem('currentGroupCode');
            const savedUser = localStorage.getItem('currentUser');

            if (savedGroupCode && savedUser) {
                // عنده جروب ومستخدم محفوظين — دخول مباشر
                currentGroupCode = savedGroupCode;
                currentUser = JSON.parse(savedUser);
                // ملء كود الجروب في الشاشة
                const codeInput = document.getElementById('group-code-input');
                if (codeInput) codeInput.value = savedGroupCode;

                if (localStorage.getItem('biometricLockEnabled') === 'true' && window.PublicKeyCredential) {
                    showLockScreen();
                } else {
                    applyUserRole();
                }
            } else {
                // اعرض شاشة الدخول
                if (savedGroupCode) {
                    currentGroupCode = savedGroupCode;
                    const codeInput = document.getElementById('group-code-input');
                    if (codeInput) codeInput.value = savedGroupCode;
                }
                showGroupScreen();
            }
        }

        function applyUserRole() {
            // إخفاء شاشات الدخول وإظهار المحتوى
            document.getElementById('group-screen').style.display = 'none';
            document.getElementById('login-screen').style.display = 'none';
            document.getElementById('main-content').style.display = 'block';
            
            document.body.classList.add('is-logged-in', 'has-tabs');
            document.body.classList.remove('is-admin', 'is-user', 'is-superadmin');

            initBiometricUI();

            // السوبر أدمن (على الباز) بس هو اللي يشوف إعدادات Firebase
            // ده مربوط بالرقم السري بتاعه بالتحديد، مش بمجرد كونه "أدمن" في أي جروب
            if (currentUser.passwordHash === ADMIN_PASSWORD_HASH) {
                document.body.classList.add('is-superadmin');
            }
            
            if (currentUser.role === 'admin') {
                document.body.classList.add('is-admin');
                document.getElementById('user-badge').classList.remove('user', 'guest');
                document.getElementById('user-badge').classList.add('admin');
                document.getElementById('user-status').textContent = currentUser.name;
            } else {
                document.body.classList.add('is-user');
                document.getElementById('user-badge').classList.remove('admin', 'guest');
                document.getElementById('user-badge').classList.add('user');
                document.getElementById('user-status').textContent = currentUser.name;
            }

            // تحديث اسم الجروب في الهيدر
            if (currentGroupCode) {
                get(ref(db, `groups/${currentGroupCode}/info`)).then(snap => {
                    if (snap.exists()) {
                        const groupTitle = document.querySelector('.logo-text p');
                        if (groupTitle) groupTitle.textContent = snap.val().name;
                    }
                }).catch(() => {});
            }

            // تحديث بيانات هيدر البروفايل في صفحة الإعدادات
            const settingsNameEl = document.getElementById('settings-my-name');
            if (settingsNameEl) settingsNameEl.textContent = currentUser.name;
            const settingsRoleEl = document.getElementById('settings-my-role');
            if (settingsRoleEl) settingsRoleEl.textContent = currentUser.role === 'admin' ? '👑 مشرف' : '👤 عضو';
            const settingsAvatarEl = document.getElementById('settings-avatar-initial');
            if (settingsAvatarEl) settingsAvatarEl.textContent = (currentUser.name || '؟').trim().charAt(0);

            // تشغيل الاستماع للبيانات
            listenToData();

            // استعادة آخر تاب كان مفتوح
            restoreActivePage();
        }

        // ================================
        // 🧩 نظام الصفحة الفرعية العام
        // ================================
        window.openSubpage = function(title, contentHtml) {
            document.getElementById('subpage-title').textContent = title;
            document.getElementById('subpage-content').innerHTML = contentHtml;
            document.getElementById('subpage-overlay').style.display = 'flex';
        };

        window.closeSubpage = function() {
            document.getElementById('subpage-overlay').style.display = 'none';
            document.getElementById('subpage-content').innerHTML = '';
            if (window.__consumeOverlayHistory) window.__consumeOverlayHistory();
        };

        window.openContactSubpage = function() {
            openSubpage('💬 تواصل معنا', `
                <div class="settings-group" style="padding:0;">
                    <a href="https://wa.me/966547354506" target="_blank" rel="noopener" class="btn btn-primary" style="text-decoration:none;">
                        🟢 تواصل عبر واتساب
                    </a>
                    <a href="mailto:elbaz8030@gmail.com" class="btn btn-outline" style="text-decoration:none;">
                        📧 elbaz8030@gmail.com
                    </a>
                </div>
            `);
        };

        window.openPotSubpage = function() {
            openSubpage('🏺 الحصالة المشتركة', `
                <div class="pot-balance-box">
                    <div class="pot-balance-label">رصيد الحصالة الحالي</div>
                    <div class="pot-balance-amount" id="pot-balance-amount">0.00 <span>ج.م</span></div>
                </div>
                <div class="settings-group" style="padding:0; margin-bottom:14px;">
                    <button type="button" class="btn btn-primary" onclick="toggleContributeForm()">➕ ساهم في الحصالة</button>
                </div>
                <div id="contribute-form-panel" style="display:none; margin-bottom:14px;">
                    <form onsubmit="submitContribution(event)" style="display:flex; gap:8px;">
                        <input type="number" step="0.01" min="0.01" id="contribute-amount" class="form-control" placeholder="المبلغ" required>
                        <button type="submit" class="btn btn-primary btn-sm">تأكيد</button>
                    </form>
                </div>
                <div id="pot-contributions-list"></div>
            `);
            updatePotDashboard();
        };

        window.openDashboardSubpage = function() {
            openSubpage('📈 داشبورد', `
                <div class="charts-row" id="charts-row">
                    <div class="chart-card">
                        <div class="chart-card-title">🍕 المصاريف حسب الفئة</div>
                        <div id="category-chart-wrap"></div>
                    </div>
                    <div class="chart-card">
                        <div class="chart-card-title">👥 مين دفع أكتر</div>
                        <div id="payer-chart-wrap"></div>
                    </div>
                </div>
            `);
            renderCharts();
        };

        window.openExpensesLogSubpage = function() {
            openSubpage('📜 سجل المصاريف', `
                <div id="expenses-log-container"></div>
            `);
            updateExpensesLog();
        };

        window.logoutUser = function() {
            localStorage.removeItem('currentUser');
            localStorage.removeItem('biometricLockEnabled');
            localStorage.removeItem('biometricCredId');
            currentUser = null;
            document.body.classList.remove('is-logged-in', 'is-admin', 'is-user', 'is-superadmin', 'has-tabs');
            document.getElementById('login-password').value = '';
            const lock = document.getElementById('lock-screen');
            if (lock) lock.style.display = 'none';
            showGroupScreen();
        };

        // ================================
        // 👥 إدارة المستخدمين
        // ================================
        window.addUser = async function(event) {
            event.preventDefault();
            
            const name = document.getElementById('new-user-name').value.trim();
            const password = document.getElementById('new-user-password').value;
            
            if (!name || !password) {
                showAlert('يرجى إدخال الاسم والرقم السري', 'warning');
                return;
            }

            try {
                const passwordHash = await hashPassword(password);
                
                const userRef = ref(db, groupPath('users'));
                await push(userRef, {
                    name: name,
                    role: 'user',
                    passwordHash: passwordHash
                });

                showAlert(`تم إضافة المستخدم "${name}" بنجاح! 🎉`, 'success');
                
                // إغلاق المودال وتنظيف الحقول
                closeAddUserModal();
            } catch (error) {
                console.error('Error adding user:', error);
                showAlert('حدث خطأ أثناء إضافة المستخدم: ' + error.message, 'danger');
            }
        };

        window.deleteUser = async function(userId) {
            // التأكد من أن المستخدم هو Admin
            if (!currentUser || currentUser.role !== 'admin') {
                showAlert('عذراً، فقط المشرف يمكنه حذف المستخدمين', 'warning');
                return;
            }
            
            // التأكد من عدم حذف Admin نفسه
            if (userId === 'admin') {
                showAlert('لا يمكن حذف حساب المشرف!', 'danger');
                return;
            }
            
            const userName = allUsers[userId]?.name || 'المستخدم';
            
            if (!confirm(`⚠️ هل أنت متأكد من حذف المستخدم "${userName}"؟\n\nلن يتمكن من تسجيل الدخول بعد الحذف!`)) {
                return;
            }
            
            try {
                if (db) {
                    await remove(ref(db, groupPath(`users/${userId}`)));
                    showAlert(`تم حذف المستخدم "${userName}" بنجاح! ✅`, 'success');
                } else {
                    showAlert('خطأ: غير متصل بقاعدة البيانات', 'danger');
                }
            } catch (error) {
                console.error('Error deleting user:', error);
                showAlert('حدث خطأ أثناء حذف المستخدم: ' + error.message, 'danger');
            }
        };

        // ================================
        // 💳 إدارة المصاريف
        // ================================
        function updateParticipantsCheckboxes() {
            const checkboxContainer = document.getElementById('participants-checkboxes');
            const customInputsContainer = document.getElementById('participants-custom-inputs');
            
            if (!checkboxContainer || !customInputsContainer) return;
            
            checkboxContainer.innerHTML = '';
            customInputsContainer.innerHTML = '';
            
            if (Object.keys(allUsers).length === 0) {
                checkboxContainer.innerHTML = '<p style="color: var(--text-muted); font-size: 13px;">لا يوجد مستخدمين</p>';
                return;
            }
            
            // إنشاء pills للتقسيم المتساوي
            Object.keys(allUsers).forEach(userId => {
                const user = allUsers[userId];
                const isMe = userId === currentUser?.id;
                const color = getPersonColor(userId);
                
                const label = document.createElement('label');
                label.className = 'participant-pill' + (isMe ? ' selected' : '');
                label.style.setProperty('--pill-color', color.bg);
                label.innerHTML = `
                    <input type="checkbox" value="${userId}" ${isMe ? 'checked' : ''}>
                    <span class="pill-avatar-wrap">
                        ${avatarHtml(userId, user.name, 32)}
                        <span class="pill-check">✓</span>
                    </span>
                    <span class="pill-name">${user.name}${isMe ? ' (أنا)' : ''}</span>
                `;
                const cb = label.querySelector('input[type="checkbox"]');
                cb.addEventListener('change', () => {
                    label.classList.toggle('selected', cb.checked);
                });
                checkboxContainer.appendChild(label);
                
                // إنشاء input للتقسيم المخصص
                const customDiv = document.createElement('div');
                customDiv.style.cssText = 'display: flex; align-items: center; gap: 12px; padding: 8px; background: var(--bg-hover); border-radius: 6px;';
                
                const nameSpan = document.createElement('span');
                nameSpan.style.cssText = 'min-width: 100px; font-weight: 500;';
                nameSpan.textContent = user.name;
                
                const input = document.createElement('input');
                input.type = 'number';
                input.step = '0.01';
                input.min = '0';
                input.placeholder = '0.00';
                input.className = 'form-control';
                input.id = `custom-amount-${userId}`;
                input.style.cssText = 'flex: 1; max-width: 150px;';
                input.oninput = validateCustomSplit;
                input.autocomplete = 'off';
                
                const currencySpan = document.createElement('span');
                currencySpan.textContent = 'ج.م';
                currencySpan.style.color = 'var(--text-muted)';
                
                customDiv.appendChild(nameSpan);
                customDiv.appendChild(input);
                customDiv.appendChild(currencySpan);
                customInputsContainer.appendChild(customDiv);
            });
            
            updateToggleAllBtn();
        }

        window.toggleAllParticipants = function() {
            const checkboxes = document.querySelectorAll('#participants-checkboxes input[type="checkbox"]');
            // لو كلهم محددين → نلغي الكل، غير كده → نحدد الكل
            const allChecked = Array.from(checkboxes).every(cb => cb.checked);
            checkboxes.forEach(cb => {
                cb.checked = !allChecked;
                const pill = cb.closest('.participant-pill');
                if (pill) pill.classList.toggle('selected', cb.checked);
            });
            updateToggleAllBtn();
        };

        function updateToggleAllBtn() {
            const btn = document.getElementById('toggle-all-btn');
            if (!btn) return;
            const checkboxes = document.querySelectorAll('#participants-checkboxes input[type="checkbox"]');
            if (checkboxes.length === 0) return;
            const allChecked = Array.from(checkboxes).every(cb => cb.checked);
            btn.textContent = allChecked ? '✗ إلغاء الكل' : '✓ تحديد الكل';
            // ربط تحديث الزر بأي تغيير في checkbox
            checkboxes.forEach(cb => {
                cb.onchange = updateToggleAllBtn;
            });
        }

        window.toggleSplitType = function() {
            const splitType = document.querySelector('input[name="split-type"]:checked').value;
            const equalSection = document.getElementById('equal-split-section');
            const customSection = document.getElementById('custom-split-section');
            
            if (splitType === 'equal') {
                equalSection.style.display = 'block';
                customSection.style.display = 'none';
            } else {
                equalSection.style.display = 'none';
                customSection.style.display = 'block';
                validateCustomSplit(); // تحقق فوري
            }
        };

        function validateCustomSplit() {
            const amount = parseFloat(document.getElementById('expense-amount').value) || 0;
            const validationDiv = document.getElementById('split-validation');
            
            if (!validationDiv) return true;
            
            if (amount === 0) {
                validationDiv.innerHTML = '';
                return true;
            }
            
            let total = 0;
            Object.keys(allUsers).forEach(userId => {
                const input = document.getElementById(`custom-amount-${userId}`);
                if (input) {
                    total += parseFloat(input.value) || 0;
                }
            });
            
            const difference = Math.abs(total - amount);
            
            if (difference < 0.01) {
                validationDiv.style.background = '#d4edda';
                validationDiv.style.color = '#155724';
                validationDiv.style.border = '1px solid #c3e6cb';
                validationDiv.innerHTML = `✅ المجموع: ${total.toFixed(2)} ج.م = ${amount.toFixed(2)} ج.م`;
                return true;
            } else if (total > amount) {
                validationDiv.style.background = '#f8d7da';
                validationDiv.style.color = '#721c24';
                validationDiv.style.border = '1px solid #f5c6cb';
                validationDiv.innerHTML = `⚠️ المجموع: ${total.toFixed(2)} ج.م > ${amount.toFixed(2)} ج.م (زيادة ${(total - amount).toFixed(2)} ج.م)`;
                return false;
            } else {
                validationDiv.style.background = '#fff3cd';
                validationDiv.style.color = '#856404';
                validationDiv.style.border = '1px solid #ffeaa7';
                validationDiv.innerHTML = `⚠️ المجموع: ${total.toFixed(2)} ج.م < ${amount.toFixed(2)} ج.م (نقص ${(amount - total).toFixed(2)} ج.م)`;
                return false;
            }
        }

        let editingExpenseId = null;

        window.addExpense = async function(event) {
            event.preventDefault();
            
            const date = document.getElementById('expense-date').value;
            const category = document.getElementById('expense-category').value;
            const amount = parseFloat(document.getElementById('expense-amount').value);
            const desc = document.getElementById('expense-desc').value.trim();
            
            // تحديد نوع التقسيم
            const splitType = document.querySelector('input[name="split-type"]:checked').value;
            const fromPot = document.getElementById('expense-from-pot')?.checked || false;
            
            let participantsData = {};
            
            if (fromPot) {
                const potBalance = computePotBalance();
                if (amount > potBalance + 0.01) {
                    showAlert(`⚠️ رصيد الحصالة (${potBalance.toFixed(2)} ج.م) مش كفاية لدفع ${amount.toFixed(2)} ج.م`, 'warning');
                    return;
                }
                // مفيش تقسيم — المبلغ بيتخصم من الحصالة مباشرة
            } else if (splitType === 'equal') {
                // التقسيم المتساوي
                const checkboxes = document.querySelectorAll('#participants-checkboxes input[type="checkbox"]:checked');
                const participants = Array.from(checkboxes).map(cb => cb.value);
                
                if (participants.length === 0) {
                    showAlert('يرجى اختيار شخص واحد على الأقل للمشاركة في التحمل', 'warning');
                    return;
                }
                
                // تقسيم متساوي
                const shareAmount = amount / participants.length;
                participants.forEach(userId => {
                    participantsData[userId] = parseFloat(shareAmount.toFixed(2));
                });
                
            } else {
                // التقسيم المخصص
                let total = 0;
                
                Object.keys(allUsers).forEach(userId => {
                    const input = document.getElementById(`custom-amount-${userId}`);
                    if (input) {
                        const userAmount = parseFloat(input.value) || 0;
                        if (userAmount > 0) {
                            participantsData[userId] = userAmount;
                            total += userAmount;
                        }
                    }
                });
                
                // التحقق من صحة المجموع
                if (Math.abs(total - amount) > 0.01) {
                    showAlert(`⚠️ مجموع التقسيم (${total.toFixed(2)} ج.م) لا يساوي المبلغ الكلي (${amount.toFixed(2)} ج.م)`, 'danger');
                    return;
                }
                
                if (Object.keys(participantsData).length === 0) {
                    showAlert('يرجى إدخال مبلغ واحد على الأقل في التقسيم المخصص', 'warning');
                    return;
                }
            }
            
            const isEditing = !!editingExpenseId;
            const originalExpense = isEditing ? allExpenses[editingExpenseId] : null;

            const expenseRecord = {
                date: date,
                category: category,
                amount: amount,
                description: desc,
                addedBy: isEditing ? (originalExpense?.addedBy ?? currentUser.id) : currentUser.id,
                paidBy: isEditing ? (originalExpense?.paidBy ?? currentUser.id) : currentUser.id,
                splitType: splitType,
                participants: participantsData, // الآن object بدلاً من array
                fromPot: fromPot,
                timestamp: isEditing ? (originalExpense?.timestamp ?? Date.now()) : Date.now()
            };
            if (isEditing) {
                expenseRecord.editedAt = Date.now();
                expenseRecord.editedBy = currentUser.id;
            }
            
            try {
                let expenseKey = editingExpenseId;
                if (isEditing) {
                    await set(ref(db, groupPath(`expenses/${editingExpenseId}`)), expenseRecord);
                } else {
                    const newRef = push(ref(db, groupPath('expenses')));
                    expenseKey = newRef.key;
                    await set(newRef, expenseRecord);
                }

                // مزامنة سجل الحصالة المشتركة (منفصل عن المصاريف عشان يفضل موجود حتى بعد تصفير الدورة)
                if (fromPot) {
                    await set(ref(db, groupPath(`pot/spending/${expenseKey}`)), {
                        amount: amount,
                        description: desc,
                        timestamp: expenseRecord.timestamp,
                        addedBy: expenseRecord.addedBy
                    });
                } else if (isEditing) {
                    // لو كان بيتدفع من الحصالة قبل كده وتم إلغاء الخيار، رجّع سجل الحصالة
                    await set(ref(db, groupPath(`pot/spending/${expenseKey}`)), null);
                }
                
                document.getElementById('form-add-expense').reset();
                document.getElementById('expense-date').valueAsDate = new Date();
                
                // إعادة تعيين radio buttons إلى التقسيم المتساوي
                document.querySelector('input[name="split-type"][value="equal"]').checked = true;
                toggleSplitType();
                toggleFromPot();
                
                updateParticipantsCheckboxes();

                if (isEditing) {
                    showAlert('تم تحديث المصروف بنجاح! ✅', 'success');
                    exitEditMode();
                } else {
                    showAlert('تم إضافة المصروف بنجاح! ✅', 'success');
                }

                // ✨ لمسة حركية بسيطة تأكيدًا للنجاح
                const btn = document.getElementById('add-expense-submit-btn');
                if (btn) {
                    btn.classList.remove('btn-success-pop');
                    void btn.offsetWidth; // إعادة تشغيل الأنيميشن
                    btn.classList.add('btn-success-pop');
                }
                document.querySelectorAll('.stat-card').forEach(card => {
                    card.classList.remove('stat-flash');
                    void card.offsetWidth;
                    card.classList.add('stat-flash');
                });
            } catch (error) {
                console.error('Error saving expense:', error);
                showAlert('حدث خطأ أثناء حفظ المصروف: ' + error.message, 'danger');
            }
        };

        // تعديل مصروف موجود
        window.editExpense = function(expenseId) {
            const expense = allExpenses[expenseId];
            if (!expense) {
                showAlert('المصروف ده مش موجود', 'danger');
                return;
            }
            const canEdit = currentUser && (currentUser.role === 'admin' || expense.addedBy === currentUser.id);
            if (!canEdit) {
                showAlert('تقدر تعدّل بس المصاريف اللي أنت ضفتها', 'warning');
                return;
            }

            editingExpenseId = expenseId;
            switchPage('page-add');

            document.getElementById('expense-date').value = expense.date || '';
            document.getElementById('expense-category').value = expense.category || 'other';
            document.getElementById('expense-amount').value = expense.amount || '';
            document.getElementById('expense-desc').value = expense.description || '';

            const splitType = expense.splitType || 'equal';
            const radio = document.querySelector(`input[name="split-type"][value="${splitType}"]`);
            if (radio) radio.checked = true;
            toggleSplitType();

            const potCheckbox = document.getElementById('expense-from-pot');
            if (potCheckbox) potCheckbox.checked = !!expense.fromPot;
            toggleFromPot();

            updateParticipantsCheckboxes();

            const participantIds = Object.keys(expense.participants || {});
            document.querySelectorAll('#participants-checkboxes input[type="checkbox"]').forEach(cb => {
                const shouldCheck = participantIds.includes(cb.value);
                cb.checked = shouldCheck;
                const pill = cb.closest('.participant-pill');
                if (pill) pill.classList.toggle('selected', shouldCheck);
            });
            updateToggleAllBtn();

            if (splitType === 'custom') {
                participantIds.forEach(uid => {
                    const input = document.getElementById(`custom-amount-${uid}`);
                    if (input) input.value = expense.participants[uid];
                });
                validateCustomSplit();
            }

            const submitBtn = document.getElementById('add-expense-submit-btn');
            if (submitBtn) submitBtn.textContent = '💾 حفظ التعديل';
            const banner = document.getElementById('edit-expense-banner');
            if (banner) banner.style.display = 'flex';

            setTimeout(() => {
                document.getElementById('form-add-expense').scrollIntoView({ behavior: 'smooth', block: 'start' });
            }, 100);
        };

        // إلغاء وضع التعديل والرجوع لحالة الإضافة العادية
        function exitEditMode() {
            editingExpenseId = null;
            const submitBtn = document.getElementById('add-expense-submit-btn');
            if (submitBtn) submitBtn.textContent = '✅ حفظ المصروف';
            const banner = document.getElementById('edit-expense-banner');
            if (banner) banner.style.display = 'none';
        }

        window.cancelEditExpense = function() {
            exitEditMode();
            document.getElementById('form-add-expense').reset();
            document.getElementById('expense-date').valueAsDate = new Date();
            document.querySelector('input[name="split-type"][value="equal"]').checked = true;
            toggleSplitType();
            toggleFromPot();
            updateParticipantsCheckboxes();
        };

        // ================================
        // 💬 تعليقات على المصاريف
        // ================================
        function escapeHtml(str) {
            const div = document.createElement('div');
            div.textContent = str ?? '';
            return div.innerHTML;
        }

        window.toggleExpenseComments = async function(expenseId) {
            const panel = document.getElementById(`comments-panel-${expenseId}`);
            if (!panel) return;
            const isOpen = panel.style.display === 'block';
            panel.style.display = isOpen ? 'none' : 'block';
            if (!isOpen) {
                await loadExpenseComments(expenseId);
            }
        };

        async function loadExpenseComments(expenseId) {
            const listEl = document.getElementById(`comments-list-${expenseId}`);
            if (!listEl || !db) return;
            listEl.innerHTML = '<p class="exp-comments-empty">جارِ التحميل...</p>';
            try {
                const snap = await get(ref(db, groupPath(`expenses/${expenseId}/comments`)));
                const data = snap.val() || {};
                const comments = Object.keys(data)
                    .map(id => ({ id, ...data[id] }))
                    .sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));

                if (comments.length === 0) {
                    listEl.innerHTML = '<p class="exp-comments-empty">لسه مفيش تعليقات، اكتب أول واحد 👇</p>';
                    return;
                }
                listEl.innerHTML = comments.map(c => {
                    const user = allUsers[c.userId];
                    const name = user ? user.name : 'مستخدم محذوف';
                    const color = getPersonColor(c.userId).bg;
                    return `
                        <div class="exp-comment">
                            <span class="exp-comment-author" style="color:${color};">${escapeHtml(name)}</span>
                            <span class="exp-comment-text">${escapeHtml(c.text)}</span>
                        </div>
                    `;
                }).join('');
            } catch (error) {
                listEl.innerHTML = '<p class="exp-comments-empty">تعذّر تحميل التعليقات</p>';
            }
        }

        window.submitExpenseComment = async function(event, expenseId) {
            event.preventDefault();
            const input = document.getElementById(`comment-input-${expenseId}`);
            const text = input.value.trim();
            if (!text || !currentUser) return;

            try {
                await push(ref(db, groupPath(`expenses/${expenseId}/comments`)), {
                    text: text,
                    userId: currentUser.id,
                    timestamp: Date.now()
                });
                input.value = '';
                await loadExpenseComments(expenseId);
            } catch (error) {
                showAlert('حدث خطأ في إرسال التعليق: ' + error.message, 'danger');
            }
        };

        window.deleteExpense = async function(expenseId) {
            // التأكد من أن المستخدم هو Admin
            if (!currentUser || currentUser.role !== 'admin') {
                showAlert('عذراً، فقط المشرف يمكنه حذف المصاريف', 'warning');
                return;
            }
            
            if (!confirm('⚠️ هل أنت متأكد من حذف هذا المصروف؟\n\nسيؤثر هذا على جميع الحسابات!')) {
                return;
            }
            
            try {
                if (db) {
                    await remove(ref(db, groupPath(`expenses/${expenseId}`)));
                    // لو كان المصروف ده مدفوع من الحصالة، رجّع المبلغ (احذف سجل الحصالة المرتبط)
                    if (allExpenses[expenseId]?.fromPot) {
                        await remove(ref(db, groupPath(`pot/spending/${expenseId}`)));
                    }
                    showAlert('تم حذف المصروف بنجاح! ✅', 'success');
                } else {
                    showAlert('خطأ: غير متصل بقاعدة البيانات', 'danger');
                }
            } catch (error) {
                console.error('Error deleting expense:', error);
                showAlert('حدث خطأ أثناء حذف المصروف: ' + error.message, 'danger');
            }
        };

        // ================================
        // 📝 نظام التسجيل والطلبات
        // ================================
        
        // فتح/إغلاق مودال التسجيل
        window.openRegisterModal = function() {
            document.getElementById('register-modal').classList.add('active');
            document.getElementById('register-group-code').value = currentGroupCode || '';
            document.getElementById('register-name').value = '';
            document.getElementById('register-password').value = '';
            document.getElementById('register-password-confirm').value = '';
        };

        window.closeRegisterModal = function() {
            document.getElementById('register-modal').classList.remove('active');
        };

        // إرسال طلب تسجيل
        window.submitRegistration = async function(event) {
            event.preventDefault();

            // تحقق من كود الجروب
            const codeInput = document.getElementById('register-group-code');
            const groupCode = (codeInput && codeInput.value.trim()) || currentGroupCode;

            if (!groupCode) {
                showAlert('يرجى إدخال كود المجموعة أولاً', 'warning');
                return;
            }

            // ⏳ Rate limiting: حد أقصى طلب واحد لكل مجموعة كل 60 ثانية من نفس الجهاز
            const rateLimitKey = `regAttempt_${groupCode}`;
            const cooldownMs = 60000;
            const lastAttempt = parseInt(localStorage.getItem(rateLimitKey) || '0', 10);
            const now = Date.now();
            if (now - lastAttempt < cooldownMs) {
                const remaining = Math.ceil((cooldownMs - (now - lastAttempt)) / 1000);
                showAlert(`⏳ من فضلك انتظر ${remaining} ثانية قبل إرسال طلب جديد`, 'warning');
                return;
            }

            const submitBtn = event.target.querySelector('button[type="submit"]');

            // تحقق من وجود الجروب
            const groupSnap = await get(ref(db, `groups/${groupCode}/info`));
            if (!groupSnap.exists()) {
                showAlert('❌ كود المجموعة غير صحيح', 'danger');
                closeRegisterModal();
                return;
            }
            
            const name = document.getElementById('register-name').value.trim();
            const password = document.getElementById('register-password').value;
            const passwordConfirm = document.getElementById('register-password-confirm').value;
            
            if (password !== passwordConfirm) {
                showAlert('الرقم السري غير متطابق!', 'danger');
                return;
            }
            
            if (password.length < 4) {
                showAlert('الرقم السري يجب أن يكون 4 أرقام على الأقل', 'warning');
                return;
            }

            if (submitBtn) submitBtn.disabled = true;
            try {
                const passwordHash = await hashPassword(password);
                const requestData = {
                    name: name,
                    passwordHash: passwordHash,
                    timestamp: Date.now(),
                    status: 'pending'
                };

                localStorage.setItem(rateLimitKey, String(Date.now()));
                await push(ref(db, `groups/${groupCode}/registration_requests`), requestData);
                closeRegisterModal();
                showAlert('✅ تم إرسال طلبك! سيتم مراجعته من قبل المشرف', 'success');
            } catch (error) {
                showAlert('حدث خطأ: ' + error.message, 'danger');
            } finally {
                if (submitBtn) submitBtn.disabled = false;
            }
        };

        // فتح مودال طلبات التسجيل (Admin فقط)
        window.openRegistrationRequestsModal = function() {
            if (!currentUser || currentUser.role !== 'admin') {
                showAlert('هذه الميزة متاحة للمشرف فقط', 'warning');
                return;
            }
            
            document.getElementById('registration-requests-modal').classList.add('active');
            updateRegistrationRequestsList();
        };

        window.closeRegistrationRequestsModal = function() {
            document.getElementById('registration-requests-modal').classList.remove('active');
        };

        // تحديث قائمة الطلبات
        function updateRegistrationRequestsList() {
            const container = document.getElementById('registration-requests-container');
            container.innerHTML = '';
            
            const pendingRequests = Object.keys(allRegistrationRequests)
                .filter(id => allRegistrationRequests[id].status === 'pending')
                .map(id => ({ id, ...allRegistrationRequests[id] }))
                .sort((a, b) => b.timestamp - a.timestamp);
            
            if (pendingRequests.length === 0) {
                container.innerHTML = `
                    <div class="empty-state">
                        <div class="empty-state-icon">✅</div>
                        <div class="empty-state-text">لا توجد طلبات معلقة</div>
                    </div>
                `;
                return;
            }
            
            pendingRequests.forEach(request => {
                const date = new Date(request.timestamp);
                const timeAgo = getTimeAgo(date);
                
                const div = document.createElement('div');
                div.style.cssText = 'padding: 16px; background: var(--bg-hover); border-radius: 8px; margin-bottom: 12px; border-left: 4px solid var(--color-warning);';
                
                div.innerHTML = `
                    <div style="display: flex; justify-content: space-between; align-items: start; margin-bottom: 12px;">
                        <div>
                            <div style="font-weight: 600; font-size: 16px; margin-bottom: 4px;">
                                👤 ${request.name}
                            </div>
                            <div style="font-size: 12px; color: var(--text-muted);">
                                ${timeAgo}
                            </div>
                        </div>
                        <span class="badge" style="background: var(--color-warning);">معلق</span>
                    </div>
                    
                    <div style="display: flex; gap: 8px;">
                        <button class="btn btn-success btn-sm" onclick="approveRegistration('${request.id}')" style="flex: 1;">
                            ✅ موافقة
                        </button>
                        <button class="btn btn-danger btn-sm" onclick="rejectRegistration('${request.id}')" style="flex: 1;">
                            ❌ رفض
                        </button>
                    </div>
                `;
                
                container.appendChild(div);
            });
        }

        // موافقة على طلب
        window.approveRegistration = async function(requestId) {
            const request = allRegistrationRequests[requestId];
            if (!request) return;
            
            try {
                // إنشاء مستخدم جديد
                const newUserId = Date.now().toString();
                await set(ref(db, groupPath(`users/${newUserId}`)), {
                    name: request.name,
                    role: 'user',
                    passwordHash: request.passwordHash
                });
                
                // حذف الطلب
                await remove(ref(db, groupPath(`registration_requests/${requestId}`)));
                
                showAlert(`✅ تمت الموافقة على طلب ${request.name}`, 'success');
            } catch (error) {
                console.error('Error approving registration:', error);
                showAlert('حدث خطأ أثناء الموافقة: ' + error.message, 'danger');
            }
        };

        // رفض طلب
        window.rejectRegistration = async function(requestId) {
            const request = allRegistrationRequests[requestId];
            if (!request) return;
            
            if (!confirm(`هل أنت متأكد من رفض طلب "${request.name}"؟`)) {
                return;
            }
            
            try {
                await remove(ref(db, groupPath(`registration_requests/${requestId}`)));
                showAlert(`تم رفض طلب ${request.name}`, 'info');
            } catch (error) {
                console.error('Error rejecting registration:', error);
                showAlert('حدث خطأ أثناء الرفض: ' + error.message, 'danger');
            }
        };

        // تحديث Badge الطلبات
        function updateRegistrationRequestsBadge() {
            const badge = document.getElementById('requests-badge');
            const gridBadge = document.getElementById('requests-badge-grid');
            
            const pendingCount = Object.keys(allRegistrationRequests)
                .filter(id => allRegistrationRequests[id].status === 'pending')
                .length;
            
            if (badge) {
                if (pendingCount > 0) {
                    badge.textContent = pendingCount;
                    badge.style.display = 'inline-block';
                } else {
                    badge.style.display = 'none';
                }
            }
            if (gridBadge) {
                if (pendingCount > 0) {
                    gridBadge.textContent = pendingCount;
                    gridBadge.style.display = 'flex';
                } else {
                    gridBadge.style.display = 'none';
                }
            }

            // 📱 تحديث رقم الإشعار على أيقونة التطبيق نفسها (للمشرف فقط، وهو الوحيد اللي يقدر يتصرف في الطلبات)
            if (currentUser && currentUser.role === 'admin') {
                updateAppIconBadge(pendingCount);
            }
        }

        function updateAppIconBadge(count) {
            if (!('setAppBadge' in navigator)) return;
            try {
                if (count > 0) {
                    navigator.setAppBadge(count).catch(() => {});
                } else if ('clearAppBadge' in navigator) {
                    navigator.clearAppBadge().catch(() => {});
                }
            } catch (e) {
                // متصفح مش داعم للميزة، تجاهل بأمان
            }
        }

        // ================================
        // 📊 تحديث الواجهات
        // ================================
        function updateDashboard() {
            const dashboard = document.getElementById('dashboard');
            dashboard.innerHTML = '';
            
            if (Object.keys(allUsers).length === 0) {
                dashboard.innerHTML = '<div class="empty-state" style="grid-column: 1 / -1;"><div class="empty-state-icon">💰</div><div class="empty-state-text">لا يوجد مستخدمين</div></div>';
                return;
            }
            
            // حساب الميزانية
            const ledger = {};
            
            Object.keys(allUsers).forEach(userId => {
                ledger[userId] = {
                    name: allUsers[userId].name,
                    totalPaid: 0,
                    totalOwed: 0
                };
            });
            
            Object.keys(allExpenses).forEach(expenseId => {
                const expense = allExpenses[expenseId];
                const amount = parseFloat(expense.amount) || 0;
                const payerId = expense.paidBy;
                
                if (ledger[payerId]) {
                    ledger[payerId].totalPaid += amount;
                }
                
                const participants = expense.participants || [];
                
                // دعم كلا من النوعين: array (القديم) و object (الجديد)
                if (Array.isArray(participants)) {
                    // التقسيم القديم: array متساوي
                    const share = amount / participants.length;
                    participants.forEach(participantId => {
                        if (ledger[participantId]) {
                            ledger[participantId].totalOwed += share;
                        }
                    });
                } else {
                    // التقسيم الجديد: object مع المبالغ
                    Object.keys(participants).forEach(participantId => {
                        if (ledger[participantId]) {
                            ledger[participantId].totalOwed += parseFloat(participants[participantId]) || 0;
                        }
                    });
                }
            });
            
            Object.keys(ledger).forEach(userId => {
                const record = ledger[userId];
                const net = record.totalPaid - record.totalOwed;
                
                let statusText = '';
                let statusClass = 'neutral';
                
                if (net > 0.01) {
                    statusText = `يطالب بـ: ${net.toFixed(2)} ج.م`;
                    statusClass = 'positive';
                } else if (net < -0.01) {
                    statusText = `عليه دفع: ${Math.abs(net).toFixed(2)} ج.م`;
                    statusClass = 'negative';
                } else {
                    statusText = 'الحساب متوازن ✓';
                    statusClass = 'neutral';
                }
                
                const card = document.createElement('div');
                card.className = `summary-card ${statusClass}`;
                card.innerHTML = `
                    <div class="summary-header">
                        <div class="summary-name">${record.name}</div>
                        ${avatarHtml(userId, record.name, 40)}
                    </div>
                    <div class="summary-details">
                        <div class="summary-row">
                            <span class="summary-label">دفع:</span>
                            <span class="summary-value">${record.totalPaid.toFixed(2)} ج.م</span>
                        </div>
                        <div class="summary-row">
                            <span class="summary-label">عليه:</span>
                            <span class="summary-value">${record.totalOwed.toFixed(2)} ج.م</span>
                        </div>
                    </div>
                    <div class="summary-status ${statusClass}">${statusText}</div>
                `;
                
                dashboard.appendChild(card);
            });
        }

        // ================================
        // 💰 التسوية النهائية (Debt Simplification)
        // ================================
        // ================================
        // 🔒 قفل الجلسة بالبصمة (محلي على الجهاز فقط)
        // ================================
        function randomChallenge() {
            return crypto.getRandomValues(new Uint8Array(32));
        }

        async function initBiometricUI() {
            const card = document.getElementById('biometric-security-card');
            const label = document.getElementById('security-section-label');
            const toggle = document.getElementById('biometric-lock-toggle');
            if (!card || !toggle) return;

            const supported = !!(window.PublicKeyCredential &&
                await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable().catch(() => false));

            if (!supported) {
                card.style.display = 'none';
                if (label) label.style.display = 'none';
                return;
            }
            card.style.display = 'block';
            if (label) label.style.display = 'block';
            toggle.checked = localStorage.getItem('biometricLockEnabled') === 'true';
        }

        window.toggleBiometricLock = async function(event) {
            const enable = event.target.checked;

            if (enable) {
                try {
                    const credential = await navigator.credentials.create({
                        publicKey: {
                            challenge: randomChallenge(),
                            rp: { name: 'مصاريف' },
                            user: {
                                id: new TextEncoder().encode(currentUser?.id || 'user'),
                                name: currentUser?.name || 'مستخدم',
                                displayName: currentUser?.name || 'مستخدم'
                            },
                            pubKeyCredParams: [{ alg: -7, type: 'public-key' }, { alg: -257, type: 'public-key' }],
                            authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required' },
                            timeout: 60000
                        }
                    });
                    if (!credential) throw new Error('لم يتم إنشاء بصمة');

                    const credId = btoa(String.fromCharCode(...new Uint8Array(credential.rawId)));
                    localStorage.setItem('biometricLockEnabled', 'true');
                    localStorage.setItem('biometricCredId', credId);
                    showAlert('✅ اتفعّل قفل البصمة — هيتطلب منك تأكيد بصمتك المرة الجاية', 'success');
                } catch (error) {
                    event.target.checked = false;
                    showAlert('تعذّر تفعيل البصمة: ' + error.message, 'danger');
                }
            } else {
                localStorage.removeItem('biometricLockEnabled');
                localStorage.removeItem('biometricCredId');
                showAlert('تم إيقاف قفل البصمة', 'info');
            }
        };

        function showLockScreen() {
            const lock = document.getElementById('lock-screen');
            if (lock) lock.style.display = 'flex';
            // محاولة تلقائية أول ما الشاشة تظهر
            setTimeout(() => attemptBiometricUnlock(), 300);
        }

        window.attemptBiometricUnlock = async function() {
            try {
                const credId = localStorage.getItem('biometricCredId');
                const allowCredentials = credId
                    ? [{ id: Uint8Array.from(atob(credId), c => c.charCodeAt(0)), type: 'public-key' }]
                    : [];

                await navigator.credentials.get({
                    publicKey: {
                        challenge: randomChallenge(),
                        allowCredentials: allowCredentials,
                        userVerification: 'required',
                        timeout: 60000
                    }
                });

                const lock = document.getElementById('lock-screen');
                if (lock) lock.style.display = 'none';
                applyUserRole();
            } catch (error) {
                // المستخدم لغى أو فشل التحقق — يفضل القفل شغال
            }
        };

        // ================================
        // 🏺 الحصالة المشتركة
        // ================================
        function computePotBalance() {
            const totalContrib = Object.values(allPotContributions).reduce((s, c) => s + (parseFloat(c.amount) || 0), 0);
            const totalSpent = Object.values(allPotSpending).reduce((s, p) => s + (parseFloat(p.amount) || 0), 0);
            return totalContrib - totalSpent;
        }

        function updatePotDashboard() {
            const balanceEl = document.getElementById('pot-balance-amount');
            if (balanceEl) {
                balanceEl.innerHTML = `${computePotBalance().toFixed(2)} <span>ج.م</span>`;
            }

            const listEl = document.getElementById('pot-contributions-list');
            if (!listEl) return;

            const contributions = Object.keys(allPotContributions)
                .map(id => ({ id, ...allPotContributions[id] }))
                .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0))
                .slice(0, 10);

            if (contributions.length === 0) {
                listEl.innerHTML = '<p class="exp-comments-empty">لسه محدش ساهم في الحصالة</p>';
                return;
            }

            listEl.innerHTML = contributions.map(c => {
                const user = allUsers[c.userId];
                const name = user ? user.name : 'مستخدم';
                const date = c.timestamp ? new Date(c.timestamp).toLocaleDateString('ar-EG') : '';
                return `
                    <div class="pot-contribution-item">
                        <span>${escapeHtml(name)} — ${date}</span>
                        <span class="pot-contribution-amount">+${parseFloat(c.amount).toFixed(2)} ج.م</span>
                    </div>
                `;
            }).join('');
        }

        window.toggleContributeForm = function() {
            const panel = document.getElementById('contribute-form-panel');
            if (panel) panel.style.display = panel.style.display === 'block' ? 'none' : 'block';
        };

        window.submitContribution = async function(event) {
            event.preventDefault();
            if (!currentUser) return;
            const input = document.getElementById('contribute-amount');
            const amount = parseFloat(input.value);

            if (!amount || amount <= 0) {
                showAlert('من فضلك ادخل مبلغ صحيح', 'warning');
                return;
            }

            try {
                await push(ref(db, groupPath('pot/contributions')), {
                    userId: currentUser.id,
                    amount: amount,
                    timestamp: Date.now()
                });
                input.value = '';
                const panel = document.getElementById('contribute-form-panel');
                if (panel) panel.style.display = 'none';
                showAlert(`تمت المساهمة بـ ${amount.toFixed(2)} ج.م في الحصالة 🏺`, 'success');
            } catch (error) {
                showAlert('حدث خطأ: ' + error.message, 'danger');
            }
        };

        window.toggleFromPot = function() {
            const checkbox = document.getElementById('expense-from-pot');
            const section = document.getElementById('participants-section');
            if (!checkbox || !section) return;
            section.style.display = checkbox.checked ? 'none' : 'block';
        };

        // ================================
        // 💵 مساعدات دفعات التسوية
        // ================================
        function getPairKey(a, b) {
            return [a, b].sort().join('_');
        }

        function getPaymentsStore(mode) {
            return mode === 'direct' ? allDirectSettlementPayments : allSettlementPayments;
        }
        function getPaymentsPath(mode) {
            return mode === 'direct' ? 'directSettlementPayments' : 'settlementPayments';
        }

        // إجمالي المبلغ المؤكد استلامه من fromId إلى toId
        function getConfirmedPaidAmount(mode, fromId, toId) {
            const store = getPaymentsStore(mode);
            const pairKey = getPairKey(fromId, toId);
            const payments = store[pairKey] || {};
            return Object.values(payments)
                .filter(p => p.status === 'confirmed' && p.fromId === fromId && p.toId === toId)
                .reduce((sum, p) => sum + (parseFloat(p.amount) || 0), 0);
        }

        // الدفعات المعلقة (لسه محتاجة تأكيد) في اتجاه معين
        function getPendingPayments(mode, fromId, toId) {
            const store = getPaymentsStore(mode);
            const pairKey = getPairKey(fromId, toId);
            const payments = store[pairKey] || {};
            return Object.keys(payments)
                .map(id => ({ id, ...payments[id] }))
                .filter(p => p.status === 'pending' && p.fromId === fromId && p.toId === toId);
        }

        window.toggleRecordPayment = function(settleId) {
            const panel = document.getElementById(`pay-panel-${settleId}`);
            if (!panel) return;
            panel.style.display = panel.style.display === 'block' ? 'none' : 'block';
        };

        window.submitPayment = async function(event, mode, fromId, toId) {
            event.preventDefault();
            const settleId = `${mode}-${fromId}__${toId}`;
            const input = document.getElementById(`pay-amount-${settleId}`);
            const amount = parseFloat(input.value);

            if (!amount || amount <= 0) {
                showAlert('من فضلك ادخل مبلغ صحيح', 'warning');
                return;
            }

            const pairKey = getPairKey(fromId, toId);
            try {
                await push(ref(db, groupPath(`${getPaymentsPath(mode)}/${pairKey}`)), {
                    fromId: fromId,
                    toId: toId,
                    amount: amount,
                    status: 'pending',
                    timestamp: Date.now()
                });
                showAlert(`✅ سجّلنا إنك دفعت ${amount.toFixed(2)} ج.م، مستني تأكيد الطرف التاني`, 'success');
            } catch (error) {
                showAlert('حدث خطأ: ' + error.message, 'danger');
            }
        };

        window.confirmPayment = async function(mode, fromId, toId, paymentId) {
            const pairKey = getPairKey(fromId, toId);
            try {
                await set(ref(db, groupPath(`${getPaymentsPath(mode)}/${pairKey}/${paymentId}/status`)), 'confirmed');
                await set(ref(db, groupPath(`${getPaymentsPath(mode)}/${pairKey}/${paymentId}/confirmedAt`)), Date.now());
                showAlert('✅ تم تأكيد استلام الدفعة', 'success');
            } catch (error) {
                showAlert('حدث خطأ: ' + error.message, 'danger');
            }
        };

        window.rejectPayment = async function(mode, fromId, toId, paymentId) {
            const pairKey = getPairKey(fromId, toId);
            try {
                await set(ref(db, groupPath(`${getPaymentsPath(mode)}/${pairKey}/${paymentId}`)), null);
                showAlert('تم إلغاء الدفعة، لسه المبلغ متسجلش', 'info');
            } catch (error) {
                showAlert('حدث خطأ: ' + error.message, 'danger');
            }
        };

        // حساب كل التسويات الظاهرة حاليًا (بعد خصم المدفوع المؤكد) — تُستخدم في العرض وفي توليد صورة الملخص
        function computeVisibleSettlements() {
            // ===== التسوية المباشرة: الصافي بين كل طرفين =====
            // pairDebts[A][B] = المبلغ اللي A عليه لـ B
            const pairDebts = {};
            
            function addDebt(debtorId, creditorId, amount) {
                if (!debtorId || !creditorId || debtorId === creditorId) return;
                if (amount <= 0) return;
                if (!pairDebts[debtorId]) pairDebts[debtorId] = {};
                if (!pairDebts[debtorId][creditorId]) pairDebts[debtorId][creditorId] = 0;
                pairDebts[debtorId][creditorId] += amount;
            }
            
            // من المصاريف: كل مشارك عليه حصته للي دفع (ما عدا المصاريف المدفوعة من الحصالة المشتركة)
            Object.keys(allExpenses).forEach(expenseId => {
                const expense = allExpenses[expenseId];
                if (expense.fromPot) return; // اتدفعت من الحصالة، مفيش مديونية شخصية
                const amount = parseFloat(expense.amount) || 0;
                const payerId = expense.paidBy;
                const participants = expense.participants || [];
                
                if (Array.isArray(participants)) {
                    const share = amount / participants.length;
                    participants.forEach(pid => {
                        if (pid !== payerId) addDebt(pid, payerId, share);
                    });
                } else {
                    Object.keys(participants).forEach(pid => {
                        const share = parseFloat(participants[pid]) || 0;
                        if (pid !== payerId) addDebt(pid, payerId, share);
                    });
                }
            });
            
            // حساب الصافي بين كل طرفين (لو في ديون متبادلة نطرحهم)
            const settlements = [];
            const processedPairs = {};
            
            Object.keys(pairDebts).forEach(debtorId => {
                Object.keys(pairDebts[debtorId]).forEach(creditorId => {
                    const pairKey = [debtorId, creditorId].sort().join('|');
                    if (processedPairs[pairKey]) return;
                    processedPairs[pairKey] = true;
                    
                    const aToB = (pairDebts[debtorId] && pairDebts[debtorId][creditorId]) || 0;
                    const bToA = (pairDebts[creditorId] && pairDebts[creditorId][debtorId]) || 0;
                    const net = aToB - bToA;
                    
                    if (Math.abs(net) < 0.01) return; // متعادلين
                    
                    if (net > 0) {
                        settlements.push({
                            fromId: debtorId, from: allUsers[debtorId]?.name || '؟',
                            toId: creditorId, to: allUsers[creditorId]?.name || '؟',
                            amount: net
                        });
                    } else {
                        settlements.push({
                            fromId: creditorId, from: allUsers[creditorId]?.name || '؟',
                            toId: debtorId, to: allUsers[debtorId]?.name || '؟',
                            amount: -net
                        });
                    }
                });
            });
            
            // خصم المدفوع المؤكد بالفعل من كل تسوية، وإخفاء اللي اتسددت بالكامل
            settlements.forEach(s => {
                s.grossAmount = s.amount;
                s.paidAmount = getConfirmedPaidAmount('detailed', s.fromId, s.toId);
                s.amount = Math.max(0, s.grossAmount - s.paidAmount);
                s.pendingPayments = getPendingPayments('detailed', s.fromId, s.toId);
            });
            return settlements.filter(s => s.amount > 0.01 || s.pendingPayments.length > 0);
        }

        // صافي كل شخص (اللي دفعه فعليًا ناقص نصيبه المفروض) — أساس التسوية المباشرة
        function computeNetBalances() {
            const net = {};
            Object.keys(allUsers).forEach(uid => { net[uid] = 0; });

            Object.keys(allExpenses).forEach(expenseId => {
                const expense = allExpenses[expenseId];
                if (expense.fromPot) return;
                const amount = parseFloat(expense.amount) || 0;
                const payerId = expense.paidBy;
                const participants = expense.participants || [];

                if (net[payerId] === undefined) net[payerId] = 0;
                net[payerId] += amount;

                if (Array.isArray(participants)) {
                    const share = amount / participants.length;
                    participants.forEach(pid => {
                        if (net[pid] === undefined) net[pid] = 0;
                        net[pid] -= share;
                    });
                } else {
                    Object.keys(participants).forEach(pid => {
                        const share = parseFloat(participants[pid]) || 0;
                        if (net[pid] === undefined) net[pid] = 0;
                        net[pid] -= share;
                    });
                }
            });
            return net;
        }

        // تبسيط الديون لأقل عدد تحويلات ممكن (خوارزمية Greedy الكلاسيكية)
        function greedySimplifyDebts(net) {
            const creditors = [];
            const debtors = [];
            Object.keys(net).forEach(uid => {
                const v = net[uid];
                if (v > 0.01) creditors.push({ id: uid, amount: v });
                else if (v < -0.01) debtors.push({ id: uid, amount: -v });
            });
            creditors.sort((a, b) => b.amount - a.amount);
            debtors.sort((a, b) => b.amount - a.amount);

            const results = [];
            let i = 0, j = 0;
            while (i < debtors.length && j < creditors.length) {
                const debtor = debtors[i];
                const creditor = creditors[j];
                const amount = Math.min(debtor.amount, creditor.amount);
                if (amount > 0.01) {
                    results.push({ fromId: debtor.id, toId: creditor.id, amount: amount });
                }
                debtor.amount -= amount;
                creditor.amount -= amount;
                if (debtor.amount < 0.01) i++;
                if (creditor.amount < 0.01) j++;
            }
            return results;
        }

        // حساب التسوية المباشرة (أقل عدد تحويلات) — نفس الأرصدة النهائية بس مسارات أقصر
        function computeDirectSettlements() {
            const net = computeNetBalances();
            const settlements = greedySimplifyDebts(net).map(s => ({
                fromId: s.fromId, from: allUsers[s.fromId]?.name || '؟',
                toId: s.toId, to: allUsers[s.toId]?.name || '؟',
                amount: s.amount
            }));

            settlements.forEach(s => {
                s.grossAmount = s.amount;
                s.paidAmount = getConfirmedPaidAmount('direct', s.fromId, s.toId);
                s.amount = Math.max(0, s.grossAmount - s.paidAmount);
                s.pendingPayments = getPendingPayments('direct', s.fromId, s.toId);
            });
            return settlements.filter(s => s.amount > 0.01 || s.pendingPayments.length > 0);
        }

        let settlementViewMode = 'detailed';

        window.setSettlementMode = function(mode) {
            settlementViewMode = mode;
            document.getElementById('mode-btn-detailed')?.classList.toggle('active', mode === 'detailed');
            document.getElementById('mode-btn-direct')?.classList.toggle('active', mode === 'direct');
            updateSettlementsDashboard();
        };

        function updateSettlementsDashboard() {
            const container = document.getElementById('settlements-dashboard');
            if (!container) return;
            
            if (!currentUser) {
                container.innerHTML = '<div class="empty-state"><div class="empty-state-icon">🔐</div><div class="empty-state-text">يرجى تسجيل الدخول</div></div>';
                return;
            }
            
            container.innerHTML = '';
            
            if (Object.keys(allUsers).length === 0) {
                container.innerHTML = '<div class="empty-state"><div class="empty-state-icon">👥</div><div class="empty-state-text">لا يوجد مستخدمين</div></div>';
                return;
            }
            
            const mode = settlementViewMode;
            const visibleSettlements = mode === 'direct' ? computeDirectSettlements() : computeVisibleSettlements();

            // ترتيب: التحويلات اللي تخص المستخدم الحالي الأول، ثم حسب المبلغ
            visibleSettlements.sort((a, b) => {
                const aMine = (a.fromId === currentUser.id || a.toId === currentUser.id) ? 1 : 0;
                const bMine = (b.fromId === currentUser.id || b.toId === currentUser.id) ? 1 : 0;
                if (aMine !== bMine) return bMine - aMine;
                return b.amount - a.amount;
            });
            
            // عرض التسويات
            if (visibleSettlements.length === 0) {
                container.innerHTML = `
                    <div style="text-align: center; padding: 24px;">
                        <div style="font-size: 48px; margin-bottom: 12px;">✅</div>
                        <div style="font-size: 18px; font-weight: 600; color: var(--color-success); margin-bottom: 8px;">
                            حساباتك متوازنة!
                        </div>
                        <div style="font-size: 14px; color: var(--text-muted);">
                            لا توجد مديونيات
                        </div>
                    </div>
                `;
                return;
            }
            
            let html = '<div style="display: flex; flex-direction: column; gap: 12px;">';
            
            visibleSettlements.forEach((settlement, index) => {
                const isCurrentUser = settlement.fromId === currentUser?.id || settlement.toId === currentUser?.id;
                const highlight = isCurrentUser ? 'background: var(--bg-primary); border: 2px solid var(--color-primary);' : 'background: var(--bg-hover);';
                
                const fromColor = getPersonColor(settlement.fromId).bg;
                const toColor = getPersonColor(settlement.toId).bg;
                const settleId = `${mode}-${settlement.fromId}__${settlement.toId}`;

                // شريط تقدم لو فيه مبلغ مدفوع مؤكد من قبل
                let progressHtml = '';
                if (settlement.paidAmount > 0.01) {
                    const pct = Math.min(100, (settlement.paidAmount / settlement.grossAmount) * 100);
                    progressHtml = `
                        <div class="settle-progress">
                            <div class="settle-progress-bar" style="width:${pct}%;"></div>
                        </div>
                        <div class="settle-progress-label">اتدفع ${settlement.paidAmount.toFixed(2)} ج.م من أصل ${settlement.grossAmount.toFixed(2)} ج.م</div>
                    `;
                }

                // زرار تسجيل دفعة (يظهر للمدين بس)
                let payActionHtml = '';
                if (currentUser?.id === settlement.fromId) {
                    payActionHtml = `
                        <button type="button" class="btn btn-outline btn-sm settle-pay-btn" onclick="toggleRecordPayment('${settleId}')">💰 سجّل إنك دفعت</button>
                        <div class="settle-pay-panel" id="pay-panel-${settleId}" style="display:none;">
                            <form onsubmit="submitPayment(event, '${mode}', '${settlement.fromId}', '${settlement.toId}')">
                                <input type="number" step="0.01" min="0.01" max="${settlement.amount.toFixed(2)}" id="pay-amount-${settleId}" class="form-control" value="${settlement.amount.toFixed(2)}" required>
                                <button type="submit" class="btn btn-primary btn-sm">تسجيل</button>
                            </form>
                            <div class="settle-pay-hint">هيتبعت لـ ${settlement.to} عشان يأكد إنه استلم</div>
                        </div>
                    `;
                }

                // الدفعات المعلقة اللي محتاجة تأكيد من الدائن
                let pendingHtml = '';
                if (currentUser?.id === settlement.toId && settlement.pendingPayments.length > 0) {
                    pendingHtml = settlement.pendingPayments.map(p => `
                        <div class="settle-pending-item">
                            <span>⏳ ${settlement.from} قال إنه دفعلك <strong>${parseFloat(p.amount).toFixed(2)} ج.م</strong></span>
                            <div class="settle-pending-actions">
                                <button class="btn btn-success btn-sm" onclick="confirmPayment('${mode}', '${settlement.fromId}', '${settlement.toId}', '${p.id}')">✅ تأكيد الاستلام</button>
                                <button class="btn btn-outline btn-sm" onclick="rejectPayment('${mode}', '${settlement.fromId}', '${settlement.toId}', '${p.id}')">❌ لم يصلني</button>
                            </div>
                        </div>
                    `).join('');
                }

                html += `
                    <div style="padding: 16px; ${highlight} border-radius: 8px;">
                        <div style="display: flex; align-items: center; gap: 14px;">
                            <div style="flex-shrink: 0; display: flex; align-items: center;">
                                ${avatarHtml(settlement.fromId, settlement.from, 34)}
                                <span style="margin: 0 -6px; font-size: 13px; color: var(--text-muted); background: var(--bg-card); border-radius: 50%; width: 20px; height: 20px; display: flex; align-items: center; justify-content: center; z-index: 1; border: 2px solid var(--bg-primary);">←</span>
                                ${avatarHtml(settlement.toId, settlement.to, 34)}
                            </div>
                            <div style="flex: 1;">
                                <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 4px; flex-wrap: wrap;">
                                    <span style="font-weight: 600; font-size: 15px; color: ${fromColor};">${settlement.from}</span>
                                    <span style="color: var(--text-muted); font-size: 13px;">يدفع لـ</span>
                                    <span style="font-weight: 600; font-size: 15px; color: ${toColor};">${settlement.to}</span>
                                </div>
                                <div style="font-size: 12px; color: var(--text-muted);">
                                    ${mode === 'direct' ? 'تسوية مباشرة' : 'تسوية تفصيلية'}
                                </div>
                            </div>
                            <div style="text-align: right;">
                                <div style="font-size: 20px; font-weight: 700; color: var(--color-success);">
                                    ${settlement.amount.toFixed(2)}
                                </div>
                                <div style="font-size: 12px; color: var(--text-muted);">
                                    ج.م
                                </div>
                            </div>
                        </div>
                        ${progressHtml}
                        ${pendingHtml}
                        ${payActionHtml}
                    </div>
                `;
            });
            
            html += '</div>';
            
            // إضافة ملخص
            html += `
                <div style="margin-top: 16px; padding: 12px; background: var(--bg-hover); border-radius: 8px; border-left: 4px solid var(--color-info);">
                    <div style="font-weight: 600; margin-bottom: 4px;">ℹ️ ملاحظة:</div>
                    <div style="font-size: 13px; color: var(--text-muted);">
                        ${mode === 'direct'
                            ? 'التسوية المباشرة بتقلل عدد التحويلات لأقل حاجة ممكنة — نفس المبالغ المستحقة بالظبط، بس بمسار أقصر'
                            : 'هذه التسوية تعرض حساباتك من المصاريف الخاصة بك فقط'}
                    </div>
                </div>
            `;
            
            container.innerHTML = html;
        }

        function updateExpensesLog() {
            const container = document.getElementById('expenses-log-container');
            if (!container) return;
            container.innerHTML = '';
            
            if (Object.keys(allExpenses).length === 0) {
                container.innerHTML = `<div class="empty-state"><div class="empty-state-icon">📊</div><div class="empty-state-text">لسه مفيش مصاريف مسجلة</div><div class="empty-state-subtext">أول ما تسجل مصروف هيظهر هنا، ويتحسب نصيب كل واحد تلقائيًا</div><div class="empty-state-cta"><button class="btn btn-primary btn-sm" onclick="document.getElementById('form-add-expense').scrollIntoView({behavior:'smooth', block:'center'}); document.getElementById('expense-desc')?.focus();">➕ سجل أول مصروف</button></div></div>`;
                return;
            }
            
            // تجميع المصاريف حسب المستخدم
            const expensesByUser = {};
            Object.keys(allExpenses).forEach(expenseId => {
                const expense = allExpenses[expenseId];
                const payerId = expense.paidBy;
                if (!expensesByUser[payerId]) expensesByUser[payerId] = [];
                expensesByUser[payerId].push({ id: expenseId, ...expense });
            });
            
            const sortedUsers = Object.keys(expensesByUser).sort((a, b) =>
                expensesByUser[b].length - expensesByUser[a].length
            );
            
            const categoryIcons = CATEGORY_ICONS;
            const categoryNames = CATEGORY_NAMES;
            const isAdmin = currentUser && currentUser.role === 'admin';
            
            sortedUsers.forEach(userId => {
                const userExpenses = expensesByUser[userId];
                const userName = allUsers[userId]?.name || 'غير معروف';
                const expensesCount = userExpenses.length;
                const totalAmount = userExpenses.reduce((sum, exp) => sum + parseFloat(exp.amount), 0);
                
                userExpenses.sort((a, b) => b.timestamp - a.timestamp);
                const isExpanded = localStorage.getItem(`expense-user-${userId}`) === 'expanded';
                
                // مجموعة المستخدم
                const group = document.createElement('div');
                group.className = 'exp-group';
                
                // رأس المجموعة (قابل للطي)
                const header = document.createElement('div');
                header.className = 'exp-group-header';
                header.onclick = () => toggleUserExpenses(userId);
                header.innerHTML = `
                    <div class="exp-group-info">
                        <span id="toggle-icon-${userId}" class="exp-chevron">${isExpanded ? '▼' : '◀'}</span>
                        ${avatarHtml(userId, userName, 36)}
                        <div>
                            <div class="exp-group-name">${userName}</div>
                            <div class="exp-group-meta">${expensesCount} ${expensesCount === 1 ? 'عملية' : 'عمليات'}</div>
                        </div>
                    </div>
                    <div class="exp-group-total">${totalAmount.toFixed(2)} <span>ج.م</span></div>
                `;
                group.appendChild(header);
                
                // حاوية البطاقات
                const body = document.createElement('div');
                body.className = `exp-group-body user-expense-${userId}`;
                body.style.display = isExpanded ? 'block' : 'none';
                
                userExpenses.forEach(expense => {
                    let participantsHtml = '';
                    const parts = expense.participants;
                    if (Array.isArray(parts)) {
                        participantsHtml = parts.map(id =>
                            `<span class="exp-chip" style="background:${getPersonColor(id).bg}22; color:${getPersonColor(id).bg}; border:1px solid ${getPersonColor(id).bg}44;">${allUsers[id]?.name || '؟'}</span>`
                        ).join('');
                    } else if (parts && typeof parts === 'object') {
                        participantsHtml = Object.keys(parts).map(id =>
                            `<span class="exp-chip" style="background:${getPersonColor(id).bg}22; color:${getPersonColor(id).bg}; border:1px solid ${getPersonColor(id).bg}44;">${allUsers[id]?.name || '؟'}: ${parseFloat(parts[id]).toFixed(0)}</span>`
                        ).join('');
                    }
                    
                    const catColor = CATEGORY_COLORS[expense.category] || '#94a3b8';
                    const card = document.createElement('div');
                    card.className = 'exp-card';
                    card.innerHTML = `
                        <div class="exp-card-top">
                            <div class="exp-cat" style="background:${catColor}1c; color:${catColor};">${categoryIcons[expense.category] || '📦'}</div>
                            <div class="exp-card-main">
                                <div class="exp-desc">${expense.description || categoryNames[expense.category] || 'مصروف'}</div>
                                <div class="exp-sub">${categoryNames[expense.category] || ''} • ${expense.date}</div>
                            </div>
                            <div class="exp-amount">${parseFloat(expense.amount).toFixed(2)}<span>ج.م</span></div>
                        </div>
                        <div class="exp-card-bottom">
                            <div class="exp-chips">${participantsHtml}</div>
                            <div style="display:flex; gap:6px;">
                                <button class="exp-del" onclick="toggleExpenseComments('${expense.id}')" title="تعليقات">💬</button>
                                ${(isAdmin || expense.addedBy === currentUser?.id) ? `<button class="exp-del" onclick="editExpense('${expense.id}')" title="تعديل">✏️</button>` : ''}
                                ${isAdmin ? `<button class="exp-del" onclick="deleteExpense('${expense.id}')" title="حذف">🗑️</button>` : ''}
                            </div>
                        </div>
                        <div class="exp-comments-panel" id="comments-panel-${expense.id}" style="display:none;">
                            <div class="exp-comments-list" id="comments-list-${expense.id}"></div>
                            <form class="exp-comment-form" onsubmit="submitExpenseComment(event, '${expense.id}')">
                                <input type="text" id="comment-input-${expense.id}" class="form-control" placeholder="اكتب تعليق..." autocomplete="off" maxlength="300">
                                <button type="submit" class="btn btn-primary btn-sm">إرسال</button>
                            </form>
                        </div>
                    `;
                    body.appendChild(card);
                });
                
                // زر طي في آخر المجموعة (يظهر دايمًا عشان يبقى متسق لكل الأفراد)
                if (expensesCount >= 1) {
                    const collapseBtn = document.createElement('button');
                    collapseBtn.className = 'exp-collapse-btn';
                    collapseBtn.innerHTML = `▲ طيّ عمليات ${userName}`;
                    collapseBtn.onclick = () => toggleUserExpenses(userId, true);
                    body.appendChild(collapseBtn);
                }
                
                group.appendChild(body);
                container.appendChild(group);
            });
        }
        
        window.toggleUserExpenses = function(userId, scrollToHeader) {
            const body = document.querySelector(`.user-expense-${userId}`);
            const icon = document.getElementById(`toggle-icon-${userId}`);
            if (!body || !icon) return;
            
            const isHidden = body.style.display === 'none';
            body.style.display = isHidden ? 'block' : 'none';
            icon.textContent = isHidden ? '▼' : '◀';
            localStorage.setItem(`expense-user-${userId}`, isHidden ? 'expanded' : 'collapsed');
            
            // عند الطي من الزر السفلي: ارجع لرأس المجموعة بسلاسة
            if (!isHidden && scrollToHeader) {
                const header = icon.closest('.exp-group-header');
                if (header) {
                    header.scrollIntoView({ behavior: 'smooth', block: 'center' });
                }
            }
        };

        function _oldToggleUserExpenses(userId) {
            const rows = document.querySelectorAll(`.user-expense-${userId}`);
            const icon = document.getElementById(`toggle-icon-${userId}`);
            
            if (!rows.length || !icon) return;
            
            const isHidden = rows[0].style.display === 'none';
            
            rows.forEach(row => {
                row.style.display = isHidden ? '' : 'none';
            });
            
            icon.textContent = isHidden ? '▼' : '◀';
            localStorage.setItem(`expense-user-${userId}`, isHidden ? 'expanded' : 'collapsed');
        };

        function updateStats() {
            if (!currentUser) return;
            
            let totalExpenses = 0;
            let myPaid = 0;
            let myOwed = 0;
            
            Object.values(allExpenses).forEach(expense => {
                const amount = parseFloat(expense.amount) || 0;
                totalExpenses += amount;
                
                if (!expense.fromPot && expense.paidBy === currentUser.id) {
                    myPaid += amount;
                }
                
                const participants = expense.participants || [];
                
                // دعم كلا من array و object
                if (Array.isArray(participants)) {
                    // التقسيم القديم: array
                    if (participants.includes(currentUser.id)) {
                        const share = amount / participants.length;
                        myOwed += share;
                    }
                } else {
                    // التقسيم الجديد: object
                    if (participants[currentUser.id]) {
                        myOwed += parseFloat(participants[currentUser.id]) || 0;
                    }
                }
            });
            
            const myNet = myPaid - myOwed;
            
            document.getElementById('stat-total-expenses').textContent = totalExpenses.toFixed(2) + ' ج.م';
            document.getElementById('stat-my-paid').textContent = myPaid.toFixed(2) + ' ج.م';
            document.getElementById('stat-my-owed').textContent = myOwed.toFixed(2) + ' ج.م';
            document.getElementById('stat-my-net').textContent = myNet.toFixed(2) + ' ج.م';

            renderCharts();
        }

        function getTimeAgo(date) {
            const seconds = Math.floor((new Date() - date) / 1000);
            
            if (seconds < 60) return 'منذ لحظات';
            if (seconds < 3600) return `منذ ${Math.floor(seconds / 60)} دقيقة`;
            if (seconds < 86400) return `منذ ${Math.floor(seconds / 3600)} ساعة`;
            return `منذ ${Math.floor(seconds / 86400)} يوم`;
        }

        // ================================
        // 🔄 تصفير العداد
        // ================================
        window.openResetModal = function() {
            document.getElementById('reset-modal').classList.add('active');
        };

        window.closeResetModal = function() {
            document.getElementById('reset-modal').classList.remove('active');
            document.getElementById('reset-period-name').value = '';
            document.getElementById('reset-confirm-password').value = '';
        };

        // ================================
        // ✏️ تعديل أسماء المستخدمين
        // ================================
        let editUserModalIsSelf = false;

        window.openMyProfileModal = function() {
            if (!currentUser) return;
            editUserModalIsSelf = true;
            openEditUserModal(currentUser.id);
        };

        window.openEditUserModal = function(userId) {
            const isSelf = currentUser && userId === currentUser.id;
            if (!isSelf && (!currentUser || currentUser.role !== 'admin')) {
                showAlert('عذراً، فقط المشرف يمكنه تعديل بيانات المستخدمين', 'warning');
                return;
            }
            if (!isSelf) editUserModalIsSelf = false;
            
            const user = allUsers[userId];
            if (!user) {
                showAlert('المستخدم غير موجود!', 'danger');
                return;
            }
            
            const idEl = document.getElementById('edit-user-id');
            const nameEl = document.getElementById('edit-user-name');
            const passEl = document.getElementById('edit-user-password');
            const modalEl = document.getElementById('edit-user-modal');
            
            if (!modalEl || !nameEl) {
                showAlert('خطأ في تحميل نافذة التعديل', 'danger');
                return;
            }
            
            idEl.value = userId;
            nameEl.value = user.name;
            if (passEl) passEl.value = '';
            
            // اقفل مودال إدارة المستخدمين الأول عشان التعديل يظهر (لو جاي من هناك)
            const usersModal = document.getElementById('users-modal');
            if (usersModal) usersModal.classList.remove('active');
            
            modalEl.classList.add('active');
            setTimeout(() => {
                nameEl.focus();
                nameEl.select();
            }, 100);
        };

        window.closeEditUserModal = function() {
            document.getElementById('edit-user-modal').classList.remove('active');
            document.getElementById('edit-user-id').value = '';
            document.getElementById('edit-user-name').value = '';
            document.getElementById('edit-user-password').value = '';
            // ارجع لمودال إدارة المستخدمين بس لو مكناش بنعدل بروفايلنا الشخصي
            const usersModal = document.getElementById('users-modal');
            if (!editUserModalIsSelf && usersModal) {
                usersModal.classList.add('active');
                updateUsersModalList();
            }
            editUserModalIsSelf = false;
        };

        // ================================
        // 👥 مودالات إدارة المستخدمين
        // ================================
        window.openAddUserModal = function() {
            const usersModal = document.getElementById('users-modal');
            if (usersModal) usersModal.classList.remove('active');
            document.getElementById('add-user-modal').classList.add('active');
            setTimeout(() => {
                document.getElementById('new-user-name').focus();
            }, 100);
        };

        window.closeAddUserModal = function() {
            document.getElementById('add-user-modal').classList.remove('active');
            document.getElementById('new-user-name').value = '';
            document.getElementById('new-user-password').value = '';
        };

        window.openUsersModal = function() {
            document.getElementById('users-modal').classList.add('active');
            updateUsersModalList();
        };

        window.closeUsersModal = function() {
            document.getElementById('users-modal').classList.remove('active');
        };

        function updateUsersModalList() {
            const list = document.getElementById('users-modal-list');
            if (!list) return;
            
            list.innerHTML = '';
            
            if (Object.keys(allUsers).length === 0) {
                list.innerHTML = '<div class="empty-state"><div class="empty-state-icon">👥</div><div class="empty-state-text">لا يوجد مستخدمين</div></div>';
                return;
            }
            
            Object.keys(allUsers).forEach(userId => {
                const user = allUsers[userId];
                
                const li = document.createElement('li');
                li.className = 'user-item';
                li.innerHTML = `
                    <div class="user-info">
                        ${avatarHtml(userId, user.name, 40)}
                        <div class="user-details">
                            <div class="user-name">${user.name}</div>
                            <div class="user-role">${user.role === 'admin' ? '👑 مشرف' : '👤 مستخدم'}</div>
                        </div>
                    </div>
                    <div style="display: flex; gap: 8px;">
                        <button class="btn btn-outline btn-sm" onclick="openEditUserModal('${userId}')" title="تعديل الاسم">
                            ✏️ تعديل
                        </button>
                        ${user.role !== 'admin' ? `<button class="btn btn-danger btn-sm" onclick="deleteUser('${userId}')" title="حذف المستخدم">🗑️ حذف</button>` : ''}
                    </div>
                `;
                list.appendChild(li);
            });
        }

        window.saveUserData = async function(event) {
            event.preventDefault();
            
            const userId = document.getElementById('edit-user-id').value;
            if (!userId) {
                showAlert('المستخدم غير محدد', 'danger');
                return;
            }
            
            const newName = document.getElementById('edit-user-name').value.trim();
            const newPassword = document.getElementById('edit-user-password').value.trim();
            
            if (!newName) {
                showAlert('يرجى إدخال اسم', 'warning');
                return;
            }
            
            const oldName = allUsers[userId]?.name || 'المستخدم';
            
            try {
                if (!db) {
                    showAlert('خطأ: غير متصل بقاعدة البيانات', 'danger');
                    return;
                }
                
                const userData = { ...allUsers[userId], name: newName };
                delete userData.passwordRaw; // تنظيف أي بيانات قديمة كانت مخزنة قبل كده بالنص الصريح
                
                // تحديث الباسورد إذا أدخل جديداً
                if (newPassword) {
                    const passwordHash = await hashPassword(newPassword);
                    userData.passwordHash = passwordHash;
                }
                
                await set(ref(db, groupPath(`users/${userId}`)), userData);
                
                // تحديث Admin إذا كان المعدَّل هو Admin
                if (userId === 'admin') {
                    window.adminName = newName;
                    localStorage.setItem('admin-name', newName);
                }

                // لو المستخدم عدّل بياناته هو نفسه، حدّث الجلسة الحالية فورًا
                if (currentUser && userId === currentUser.id) {
                    currentUser.name = newName;
                    if (userData.passwordHash) currentUser.passwordHash = userData.passwordHash;
                    localStorage.setItem('currentUser', JSON.stringify(currentUser));
                    applyUserRole();
                }
                
                closeEditUserModal();
                
                let msg = `✅ تم تحديث بيانات ${oldName}`;
                if (newPassword) msg += ' (الاسم + الباسورد)';
                else msg += ' (الاسم فقط)';
                showAlert(msg, 'success');
                
            } catch (error) {
                console.error('Error updating user:', error);
                showAlert('حدث خطأ: ' + error.message, 'danger');
            }
        };

        // ================================
        // 📊 التقارير (للجميع)
        // ================================
        window.openReportsModal = function() {
            if (!currentUser) {
                showAlert('يرجى تسجيل الدخول', 'warning');
                return;
            }
            document.getElementById('reports-modal').classList.add('active');
            renderReports();
        };

        window.closeReportsModal = function() {
            document.getElementById('reports-modal').classList.remove('active');
        };

        function renderReports() {
            const container = document.getElementById('reports-container');
            container.innerHTML = '';
            
            const reports = Object.keys(allArchive)
                .map(id => ({ id, ...allArchive[id] }))
                .sort((a, b) => b.timestamp - a.timestamp);
            
            if (reports.length === 0) {
                container.innerHTML = '<div class="empty-state"><div class="empty-state-icon">📊</div><div class="empty-state-text">لا توجد تقارير محفوظة بعد</div><div style="font-size:13px;color:var(--text-muted);margin-top:8px;">التقارير تُحفظ تلقائياً عند تصفير العداد</div></div>';
                return;
            }

            // شريط ملخص إجمالي لكل الدورات
            const totalAllTime = reports.reduce((s, r) => s + (parseFloat(r.totalExpenses) || 0), 0);
            const statsBar = document.createElement('div');
            statsBar.className = 'reports-stats-bar';
            statsBar.innerHTML = `
                <div class="reports-stat">
                    <div class="reports-stat-value">${reports.length}</div>
                    <div class="reports-stat-label">دورة مؤرشفة</div>
                </div>
                <div class="reports-stat">
                    <div class="reports-stat-value">${totalAllTime.toFixed(0)}</div>
                    <div class="reports-stat-label">إجمالي (ج.م)</div>
                </div>
                <div class="reports-stat">
                    <div class="reports-stat-value">${(totalAllTime / reports.length).toFixed(0)}</div>
                    <div class="reports-stat-label">متوسط الدورة</div>
                </div>
            `;
            container.appendChild(statsBar);
            
            reports.forEach(report => {
                const date = new Date(report.timestamp);
                const dateStr = date.toLocaleDateString('ar-EG', { year: 'numeric', month: 'long', day: 'numeric' });
                const settlement = report.settlement || [];
                const directSettlement = report.directSettlement; // undefined لو تقرير قديم قبل الميزة دي
                
                const card = document.createElement('div');
                card.className = 'report-card';
                
                function buildSettlementRowsHtml(list) {
                    if (!list || list.length === 0) {
                        return '<div class="report-balanced">✅ كانت الحسابات متوازنة</div>';
                    }
                    return list.map(s => `
                        <div class="report-settle-row">
                            <div class="report-settle-people">
                                ${avatarHtml(s.fromName, s.fromName, 26)}
                                <span class="report-arrow">←</span>
                                ${avatarHtml(s.toName, s.toName, 26)}
                                <div class="report-settle-names">
                                    <strong>${s.fromName}</strong>
                                    <span style="color:var(--text-muted); font-weight:400;"> يدفع لـ </span>
                                    <strong>${s.toName}</strong>
                                </div>
                            </div>
                            <div class="report-settle-amount">${parseFloat(s.amount).toFixed(2)} <span>ج.م</span></div>
                        </div>
                    `).join('');
                }

                const settlementHtml = buildSettlementRowsHtml(settlement);
                const directSettlementHtml = directSettlement !== undefined
                    ? buildSettlementRowsHtml(directSettlement)
                    : '<div class="report-balanced" style="color:var(--text-muted);">التقرير ده اتحفظ قبل إضافة التسوية المباشرة</div>';
                
                card.innerHTML = `
                    <div class="report-header">
                        <div style="flex:1; cursor:pointer; display:flex; align-items:center; gap:12px;" onclick="toggleReport('${report.id}')">
                            <div class="report-period-icon">📅</div>
                            <div>
                                <div class="report-name">${report.periodName || 'دورة'}</div>
                                <div class="report-meta">
                                    <span>${dateStr}</span>
                                    <span class="report-meta-pill">🧾 ${report.expensesCount || 0}</span>
                                    <span class="report-meta-pill report-meta-amount">💰 ${parseFloat(report.totalExpenses || 0).toFixed(2)} ج.م</span>
                                </div>
                            </div>
                        </div>
                        <button class="exp-del admin-only" onclick="event.stopPropagation(); deleteReport('${report.id}')" title="حذف التقرير" style="margin-inline-end:4px;">🗑️</button>
                        <span class="report-chevron" id="report-chevron-${report.id}" onclick="toggleReport('${report.id}')" style="cursor:pointer;">◀</span>
                    </div>
                    <div class="report-body" id="report-body-${report.id}" style="display:none;">
                        <div class="report-section-title">📋 التسوية التفصيلية</div>
                        ${settlementHtml}
                        <div class="report-section-title" style="margin-top:14px;">⚡ التسوية المباشرة</div>
                        ${directSettlementHtml}
                    </div>
                `;
                container.appendChild(card);
            });
        }

        window.deleteReport = async function(reportId) {
            if (!confirm('هل أنت متأكد إنك عايز تحذف التقرير ده؟ الإجراء ده نهائي.')) return;
            try {
                await set(ref(db, groupPath(`archive/${reportId}`)), null);
                showAlert('تم حذف التقرير 🗑️', 'success');
            } catch (error) {
                showAlert('حدث خطأ: ' + error.message, 'danger');
            }
        };

        window.toggleReport = function(reportId) {
            const body = document.getElementById(`report-body-${reportId}`);
            const chevron = document.getElementById(`report-chevron-${reportId}`);
            if (!body) return;
            const isHidden = body.style.display === 'none';
            body.style.display = isHidden ? 'block' : 'none';
            if (chevron) chevron.textContent = isHidden ? '▼' : '◀';
        };

        // حساب التسوية الكاملة لكل الأطراف (للتقارير - الأدمن)
        function computeFullSettlement() {
            const pairDebts = {};
            function addDebt(debtorId, creditorId, amount) {
                if (!debtorId || !creditorId || debtorId === creditorId || amount <= 0) return;
                if (!pairDebts[debtorId]) pairDebts[debtorId] = {};
                if (!pairDebts[debtorId][creditorId]) pairDebts[debtorId][creditorId] = 0;
                pairDebts[debtorId][creditorId] += amount;
            }
            
            // المصاريف
            Object.keys(allExpenses).forEach(id => {
                const e = allExpenses[id];
                if (e.fromPot) return;
                const amount = parseFloat(e.amount) || 0;
                const payer = e.paidBy;
                const parts = e.participants || [];
                if (Array.isArray(parts)) {
                    const share = amount / parts.length;
                    parts.forEach(p => { if (p !== payer) addDebt(p, payer, share); });
                } else {
                    Object.keys(parts).forEach(p => {
                        if (p !== payer) addDebt(p, payer, parseFloat(parts[p]) || 0);
                    });
                }
            });
            
            // الصافي بين كل طرفين
            const settlements = [];
            const done = {};
            Object.keys(pairDebts).forEach(a => {
                Object.keys(pairDebts[a]).forEach(b => {
                    const key = [a, b].sort().join('|');
                    if (done[key]) return;
                    done[key] = true;
                    const aToB = (pairDebts[a] && pairDebts[a][b]) || 0;
                    const bToA = (pairDebts[b] && pairDebts[b][a]) || 0;
                    const net = aToB - bToA;
                    if (Math.abs(net) < 0.01) return;
                    if (net > 0) {
                        settlements.push({ fromName: allUsers[a]?.name || '؟', toName: allUsers[b]?.name || '؟', amount: net });
                    } else {
                        settlements.push({ fromName: allUsers[b]?.name || '؟', toName: allUsers[a]?.name || '؟', amount: -net });
                    }
                });
            });
            settlements.sort((x, y) => y.amount - x.amount);
            return settlements;
        }

        // نسخة الأرشيف من التسوية المباشرة (بتستخدم صافي كل شخص + التبسيط الجشع)
        function computeFullDirectSettlement() {
            const net = computeNetBalances();
            return greedySimplifyDebts(net)
                .map(s => ({
                    fromName: allUsers[s.fromId]?.name || '؟',
                    toName: allUsers[s.toId]?.name || '؟',
                    amount: s.amount
                }))
                .sort((x, y) => y.amount - x.amount);
        }

        window.confirmReset = async function(event) {
            event.preventDefault();
            
            const periodName = document.getElementById('reset-period-name').value;
            const password = document.getElementById('reset-confirm-password').value;
            const passwordHash = await hashPassword(password);
            
            if (!currentUser || passwordHash !== currentUser.passwordHash) {
                showAlert('الرقم السري غير صحيح!', 'danger');
                return;
            }

            if (Object.keys(allExpenses).length === 0) {
                showAlert('مفيش مصاريف في الدورة الحالية أصلاً — مفيش داعي للتصفير', 'warning');
                closeResetModal();
                return;
            }
            
            // حساب التسوية الكاملة (تفصيلية ومباشرة) قبل التصفير
            const settlement = computeFullSettlement();
            const directSettlement = computeFullDirectSettlement();
            const totalExpenses = Object.values(allExpenses).reduce((s, e) => s + (parseFloat(e.amount) || 0), 0);
            
            // حفظ الأرشيف (تقرير الدورة)
            const archiveRef = ref(db, groupPath(`archive/${Date.now()}`));
            await set(archiveRef, {
                periodName: periodName,
                timestamp: Date.now(),
                totalExpenses: totalExpenses,
                expensesCount: Object.keys(allExpenses).length,
                settlement: settlement,
                directSettlement: directSettlement,
                users: allUsers,
                expenses: allExpenses,
                settlementPayments: allSettlementPayments,
                directSettlementPayments: allDirectSettlementPayments,
                loans: {}
            });
            
            // تصفير كل حاجة: المصاريف والسلف ودفعات التسوية بنوعيها (دورة جديدة نظيفة)
            await set(ref(db, groupPath('expenses')), {});
            await set(ref(db, groupPath('settlementPayments')), {});
            await set(ref(db, groupPath('directSettlementPayments')), {});
            await set(ref(db, 'loans'), {});
            
            closeResetModal();
            showAlert('تم تصفير العداد وحفظ تقرير الدورة بنجاح! 🎉', 'success');
        };

        // ================================
        // 📤 مشاركة ملخص التسوية كصورة
        // ================================
        window.shareSettlementSummary = async function() {
            if (!currentUser) return;
            const settlements = settlementViewMode === 'direct' ? computeDirectSettlements() : computeVisibleSettlements();

            const width = 720;
            const rowHeight = 86;
            const headerHeight = 190;
            const footerHeight = 70;
            const height = headerHeight + Math.max(1, settlements.length) * rowHeight + footerHeight;

            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');

            // خلفية متدرجة
            const bgGrad = ctx.createLinearGradient(0, 0, width, height);
            bgGrad.addColorStop(0, '#0b1120');
            bgGrad.addColorStop(1, '#1e1b4b');
            ctx.fillStyle = bgGrad;
            ctx.fillRect(0, 0, width, height);

            ctx.direction = 'rtl';
            ctx.textAlign = 'right';

            // الهيدر
            ctx.fillStyle = '#ffffff';
            ctx.font = '700 34px Tahoma, Arial';
            ctx.fillText('💰 مصاريف — ملخص التسوية', width - 40, 60);

            ctx.font = '600 16px Tahoma, Arial';
            ctx.fillStyle = 'rgba(255,255,255,0.65)';
            const dateStr = new Date().toLocaleDateString('ar-EG', { year: 'numeric', month: 'long', day: 'numeric' });
            ctx.fillText(dateStr, width - 40, 92);

            const totalExpenses = Object.values(allExpenses).reduce((s, e) => s + (parseFloat(e.amount) || 0), 0);
            ctx.font = '600 16px Tahoma, Arial';
            ctx.fillText(`إجمالي مصاريف الدورة: ${totalExpenses.toFixed(2)} ج.م`, width - 40, 122);

            ctx.strokeStyle = 'rgba(255,255,255,0.15)';
            ctx.beginPath();
            ctx.moveTo(40, headerHeight - 20);
            ctx.lineTo(width - 40, headerHeight - 20);
            ctx.stroke();

            // الصفوف
            if (settlements.length === 0) {
                ctx.textAlign = 'center';
                ctx.font = '700 24px Tahoma, Arial';
                ctx.fillStyle = '#10b981';
                ctx.fillText('✅ كل الحسابات متوازنة', width / 2, headerHeight + 50);
                ctx.textAlign = 'right';
            } else {
                settlements.forEach((s, i) => {
                    const y = headerHeight + i * rowHeight;

                    ctx.fillStyle = i % 2 === 0 ? 'rgba(255,255,255,0.04)' : 'rgba(255,255,255,0.01)';
                    ctx.fillRect(40, y, width - 80, rowHeight - 14);

                    ctx.fillStyle = '#ffffff';
                    ctx.font = '700 20px Tahoma, Arial';
                    ctx.fillText(`${s.from}  ⟵  ${s.to}`, width - 60, y + 34);

                    ctx.font = '600 13px Tahoma, Arial';
                    ctx.fillStyle = 'rgba(255,255,255,0.55)';
                    ctx.fillText('تسوية مباشرة', width - 60, y + 56);

                    ctx.textAlign = 'left';
                    ctx.font = '700 24px Tahoma, Arial';
                    ctx.fillStyle = '#34d399';
                    ctx.fillText(`${s.amount.toFixed(2)} ج.م`, 60, y + 42);
                    ctx.textAlign = 'right';
                });
            }

            // الفوتر
            ctx.textAlign = 'center';
            ctx.font = '600 13px Tahoma, Arial';
            ctx.fillStyle = 'rgba(255,255,255,0.4)';
            ctx.fillText('Developed by Ali Elbaz', width / 2, height - 26);
            ctx.textAlign = 'right';

            canvas.toBlob(async (blob) => {
                if (!blob) {
                    showAlert('حدث خطأ في توليد الصورة', 'danger');
                    return;
                }
                const file = new File([blob], 'تسوية-المصاريف.png', { type: 'image/png' });

                if (navigator.canShare && navigator.canShare({ files: [file] })) {
                    try {
                        await navigator.share({
                            files: [file],
                            title: 'ملخص التسوية',
                            text: 'ملخص تسوية المصاريف المشتركة'
                        });
                        return;
                    } catch (e) {
                        if (e.name === 'AbortError') return; // المستخدم لغى المشاركة
                    }
                }

                // fallback: تحميل الصورة مباشرة
                const link = document.createElement('a');
                link.href = URL.createObjectURL(blob);
                link.download = 'تسوية-المصاريف.png';
                link.click();
                showAlert('تم تحميل الصورة 📥', 'success');
            }, 'image/png');
        };

        // ================================
        // 📱 التنقل بين الصفحات (تابس)
        // ================================
        window.switchPage = function(pageId) {
            document.querySelectorAll('.app-page').forEach(page => {
                page.classList.toggle('active', page.id === pageId);
            });
            // صفحتا "إضافة" و"لوحة الحسابات" بيتفتحوا من قائمة تاب الحسابات، فلما تكونوا مفتوحين نفعّل نفس تاب الحسابات في الشريط السفلي
            const navHighlightId = (pageId === 'page-add' || pageId === 'page-accounts-dashboard') ? 'page-accounts' : pageId;
            document.querySelectorAll('.tab-btn').forEach(btn => {
                btn.classList.toggle('active', btn.dataset.page === navHighlightId);
            });
            window.scrollTo({ top: 0, behavior: 'instant' });
            localStorage.setItem('active-page', pageId);
        };

        function restoreActivePage() {
            const saved = localStorage.getItem('active-page');
            const validPages = ['page-home', 'page-add', 'page-accounts', 'page-accounts-dashboard', 'page-settlement', 'page-settings'];
            if (saved && validPages.includes(saved)) {
                switchPage(saved);
            }
        }

        // ================================
        // 🔄 طي وفرد الأقسام
        // ================================
        window.toggleSection = function(sectionId) {
            const content = document.getElementById(sectionId + '-content');
            const button = document.getElementById('toggle-' + sectionId);
            
            if (!content || !button) return;
            
            const isCollapsed = content.classList.contains('collapsed');
            
            if (isCollapsed) {
                // فرد القسم
                content.classList.remove('collapsed');
                button.textContent = '▲ إخفاء';
                localStorage.setItem(sectionId + '-state', 'expanded');
            } else {
                // طي القسم
                content.classList.add('collapsed');
                button.textContent = '▼ عرض';
                localStorage.setItem(sectionId + '-state', 'collapsed');
            }
        };

        // استعادة حالة الأقسام عند التحميل
        function restoreSectionsState() {
            const sections = ['expenses-log'];
            
            sections.forEach(sectionId => {
                const savedState = localStorage.getItem(sectionId + '-state');
                const content = document.getElementById(sectionId + '-content');
                const button = document.getElementById('toggle-' + sectionId);
                
                if (content && button) {
                    // الحالة الافتراضية: مطوي
                    if (savedState === 'expanded') {
                        content.classList.remove('collapsed');
                        button.textContent = '▲ إخفاء';
                    } else {
                        content.classList.add('collapsed');
                        button.textContent = '▼ عرض';
                    }
                }
            });
        }

        // ================================
        // 🎨 الثيم
        // ================================
        window.toggleTheme = function() {
            const body = document.body;
            const currentTheme = body.getAttribute('data-theme');
            const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
            
            body.setAttribute('data-theme', newTheme);
            localStorage.setItem('theme', newTheme);
            
            const icon = document.querySelector('.theme-toggle');
            icon.textContent = newTheme === 'dark' ? '🌙' : '☀️';
        };

        const savedTheme = localStorage.getItem('theme') || 'dark';
        document.body.setAttribute('data-theme', savedTheme);
        document.querySelector('.theme-toggle').textContent = savedTheme === 'dark' ? '🌙' : '☀️';

        // ================================
        // 🎭 المودالز
        // ================================
        window.openFirebaseConfigModal = function() {
            const isSuperAdmin = currentUser && currentUser.passwordHash === ADMIN_PASSWORD_HASH;

            if (!isSuperAdmin) {
                showAlert('❌ إعدادات Firebase متاحة للمشرف الرئيسي فقط', 'danger');
                return;
            }

            document.getElementById('config-adminName').value = window.adminName || DEFAULT_ADMIN_NAME;
            
            // ملء حقول Firebase من القيم المحفوظة أو الافتراضية
            if (!document.getElementById('config-apiKey').value) {
                document.getElementById('config-apiKey').value = DEFAULT_FIREBASE_CONFIG.apiKey;
                document.getElementById('config-authDomain').value = DEFAULT_FIREBASE_CONFIG.authDomain;
                document.getElementById('config-databaseURL').value = DEFAULT_FIREBASE_CONFIG.databaseURL;
                document.getElementById('config-projectId').value = DEFAULT_FIREBASE_CONFIG.projectId;
                document.getElementById('config-storageBucket').value = DEFAULT_FIREBASE_CONFIG.storageBucket;
                document.getElementById('config-messagingSenderId').value = DEFAULT_FIREBASE_CONFIG.messagingSenderId;
                document.getElementById('config-appId').value = DEFAULT_FIREBASE_CONFIG.appId;
            }
            
            document.getElementById('config-apiKey').readOnly = false;
            document.getElementById('config-authDomain').readOnly = false;
            document.getElementById('config-databaseURL').readOnly = false;
            document.getElementById('config-projectId').readOnly = false;
            document.getElementById('config-storageBucket').readOnly = false;
            document.getElementById('config-messagingSenderId').readOnly = false;
            document.getElementById('config-appId').readOnly = false;
            
            document.getElementById('firebase-config-modal').classList.add('active');
        };

        window.closeFirebaseConfigModal = function() {
            document.getElementById('firebase-config-modal').classList.remove('active');
        };

        document.querySelectorAll('.modal').forEach(modal => {
            modal.addEventListener('click', function(e) {
                if (e.target === this) {
                    this.classList.remove('active');
                }
            });
        });

        // ================================
        // ⚠️ التنبيهات
        // ================================
        function showAlert(message, type = 'info') {
            const container = document.getElementById('alerts-container');

            // حد أقصى 3 تنبيهات ظاهرة في نفس الوقت
            while (container.children.length >= 3) {
                container.removeChild(container.firstChild);
            }

            const alert = document.createElement('div');
            alert.className = `alert alert-${type}`;

            const icons = {
                success: '✅',
                warning: '⚠️',
                danger: '❌',
                info: 'ℹ️'
            };

            alert.innerHTML = `
                <span class="alert-icon">${icons[type]}</span>
                <span>${message}</span>
            `;

            const dismiss = () => {
                if (!alert.isConnected) return;
                alert.style.animation = 'slideOut 0.25s ease';
                setTimeout(() => alert.remove(), 250);
            };

            alert.addEventListener('click', dismiss);
            container.appendChild(alert);

            // التنبيهات المهمة (خطأ/تحذير) تفضل ظاهرة وقت أطول
            const duration = (type === 'danger' || type === 'warning') ? 6000 : 3500;
            setTimeout(dismiss, duration);
        }

        window.showAlert = showAlert;

        // ================================
        // 📱 تسجيل Service Worker (PWA)
        // ================================
        if ('serviceWorker' in navigator) {
            window.addEventListener('load', () => {
                navigator.serviceWorker.register('service-worker.js')
                    .then(() => console.log('✅ Service Worker registered'))
                    .catch(err => console.log('SW registration failed:', err));
            });
        }
