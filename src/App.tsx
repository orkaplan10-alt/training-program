import React, { useState, useEffect, useRef, Component } from 'react';
import { auth, db, googleProvider, signInWithPopup, signOut, doc, getDoc, setDoc, onSnapshot, collection, query, where, OperationType, handleFirestoreError, addDoc, deleteDoc, updateDoc, getDocs, writeBatch, Timestamp } from './firebase';
import { onAuthStateChanged, User } from 'firebase/auth';
import { UserProfile, Workout, UserRole, WorkoutTemplate } from './types';
import { LogIn, LogOut, Plus, Dumbbell, Users, ClipboardList, ChevronRight, Trash2, Send, Clock, Weight, Repeat, Save, FileText, Share2, Download, Link as LinkIcon, Check, Zap, Activity, Info, Calendar, XCircle, Video, Copy, Tag, Target, BarChart, Filter, X, ChevronLeft, Mail, MessageCircle, Sun, Moon, GripVertical } from 'lucide-react';
import { motion, AnimatePresence, Reorder } from 'motion/react';
import { BrowserRouter, Routes, Route, useParams, useNavigate, Link } from 'react-router-dom';
import { Toaster, toast } from 'sonner';
import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';

function cn(...classes: (string | boolean | undefined)[]) {
  return classes.filter(Boolean).join(' ');
}

class ErrorBoundary extends Component<any, any> {
  state = { hasError: false, error: null };

  static getDerivedStateFromError(error: any) {
    return { hasError: true, error };
  }

  componentDidCatch(error: any, errorInfo: any) {
    console.error('ErrorBoundary caught an error:', error, errorInfo);
  }

  render() {
    const { hasError, error } = this.state;
    if (hasError) {
      let errorMessage = 'משהו השתבש. אנא נסה לרענן את הדף.';
      try {
        const parsed = JSON.parse(error.message);
        if (parsed.error) errorMessage = `שגיאת מסד נתונים: ${parsed.error}`;
      } catch (e) {
        if (error && error.message) errorMessage = error.message;
      }

      return (
        <div className="min-h-screen bg-stone-50 dark:bg-stone-950 flex flex-col items-center justify-center p-6 text-center transition-colors duration-300">
          <div className="w-20 h-20 bg-red-100 dark:bg-red-900/30 rounded-2xl flex items-center justify-center mb-6">
            <Info className="w-10 h-10 text-red-600" />
          </div>
          <h2 className="text-2xl font-bold text-stone-900 dark:text-white mb-4">אופס! משהו השתבש</h2>
          <p className="text-stone-500 dark:text-stone-400 mb-8 max-w-md">{errorMessage}</p>
          <button
            onClick={() => window.location.reload()}
            className="bg-stone-900 dark:bg-white text-white dark:text-stone-900 px-8 py-3 rounded-2xl font-semibold hover:bg-stone-800 dark:hover:bg-stone-100 transition-all"
          >
            רענן דף
          </button>
        </div>
      );
    }

    return (this as any).props.children;
  }
}

export default function App() {
  return (
    <ErrorBoundary>
      <BrowserRouter>
        <Toaster position="top-center" richColors />
        <Routes>
          <Route path="/workout/:workoutId" element={<PublicWorkout />} />
          <Route path="*" element={<MainApp />} />
        </Routes>
      </BrowserRouter>
    </ErrorBoundary>
  );
}

function MainApp() {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<'dashboard' | 'create-workout' | 'client-workouts' | 'templates'>('dashboard');
  const [selectedClient, setSelectedClient] = useState<UserProfile | null>(null);
  const [pendingRole, setPendingRole] = useState<UserRole | null>(null);
  const [showAddClient, setShowAddClient] = useState(false);
  const [darkMode, setDarkMode] = useState(() => {
    const saved = localStorage.getItem('darkMode');
    return saved ? JSON.parse(saved) : false;
  });
  const navigate = useNavigate();

  useEffect(() => {
    if (darkMode) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
    localStorage.setItem('darkMode', JSON.stringify(darkMode));
  }, [darkMode]);

  useEffect(() => {
    let unsubscribeProfile: (() => void) | null = null;
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      console.log('Auth state changed:', user?.email);
      
      if (unsubscribeProfile) {
        unsubscribeProfile();
        unsubscribeProfile = null;
      }

      setUser(user);
      if (user) {
        // Use onSnapshot for reactive profile updates
        const profileRef = doc(db, 'users', user.uid);
        unsubscribeProfile = onSnapshot(profileRef, async (profileDoc) => {
          if (profileDoc.exists()) {
            console.log('Profile updated from Firestore:', user.uid);
            setProfile(profileDoc.data() as UserProfile);
            setLoading(false);
          } else {
            // Check for email-based profile (manual registration by coach)
            console.log('Profile not found by UID, checking email:', user.email);
            const emailBasedDoc = user.email ? await getDoc(doc(db, 'users', user.email.toLowerCase().trim())) : null;
            if (emailBasedDoc && emailBasedDoc.exists()) {
              console.log('Found manual profile by email, migrating...');
              const data = emailBasedDoc.data() as UserProfile;
              // Migrate to UID-based profile
              const newProfile: UserProfile = { ...data, uid: user.uid };
              await setDoc(doc(db, 'users', user.uid), newProfile);
              await deleteDoc(doc(db, 'users', data.uid)); // data.uid was the email
              
              // Update all workouts that were assigned to the email-based ID
              const workoutsQuery = query(collection(db, 'workouts'), where('clientId', '==', data.uid));
              const workoutsSnap = await getDocs(workoutsQuery);
              const batch = writeBatch(db);
              workoutsSnap.docs.forEach(d => {
                batch.update(d.ref, { clientId: user.uid });
              });
              await batch.commit();
              console.log('Migration complete for:', user.email);
              // setLoading(false) will be triggered by the next snapshot
            } else if (pendingRole) {
              console.log('Creating new profile for role:', pendingRole);
              // Auto-assign role if we have a pending preference
              const newProfile: UserProfile = {
                uid: user.uid,
                email: user.email || '',
                role: pendingRole,
                displayName: user.displayName || 'משתמש חדש',
              };
              await setDoc(doc(db, 'users', user.uid), newProfile);
              // setLoading(false) will be triggered by the next snapshot
              setPendingRole(null);
            } else {
              console.log('No profile found and no pending role.');
              setProfile(null);
              setLoading(false);
            }
          }
        }, (err) => {
          console.error('Profile snapshot error:', err);
          setLoading(false);
        });
      } else {
        setProfile(null);
        setLoading(false);
      }
    });
    return () => {
      unsubscribe();
      if (unsubscribeProfile) unsubscribeProfile();
    };
  }, [pendingRole]);

  const [loggingIn, setLoggingIn] = useState<UserRole | null>(null);

  const handleLogin = async (role?: UserRole) => {
    if (role) {
      setPendingRole(role);
      setLoggingIn(role);
    }
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (err) {
      console.error('Login error:', err);
      toast.error('התחברות נכשלה. אנא וודא שחלונות קופצים מאושרים בדפדפן.');
    } finally {
      setLoggingIn(null);
    }
  };

  const handleLogout = () => signOut(auth);

  const handleRoleSelection = async (role: UserRole) => {
    if (!user) return;
    try {
      // Check for email-based profile first (manual registration)
      const emailBasedDoc = user.email ? await getDoc(doc(db, 'users', user.email.toLowerCase().trim())) : null;
      if (emailBasedDoc && emailBasedDoc.exists()) {
        const data = emailBasedDoc.data() as UserProfile;
        const newProfile: UserProfile = { ...data, uid: user.uid, role }; // Use selected role but keep other data
        await setDoc(doc(db, 'users', user.uid), newProfile);
        await deleteDoc(doc(db, 'users', data.uid));
        
        const workoutsQuery = query(collection(db, 'workouts'), where('clientId', '==', data.uid));
        const workoutsSnap = await getDocs(workoutsQuery);
        const batch = writeBatch(db);
        workoutsSnap.docs.forEach(d => {
          batch.update(d.ref, { clientId: user.uid });
        });
        await batch.commit();
        setProfile(newProfile);
      } else {
        const newProfile: UserProfile = {
          uid: user.uid,
          email: user.email || '',
          role,
          displayName: user.displayName || 'משתמש חדש',
        };
        await setDoc(doc(db, 'users', user.uid), newProfile);
        setProfile(newProfile);
      }
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `users/${user.uid}`);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-stone-50 dark:bg-stone-950 flex items-center justify-center transition-colors duration-300">
        <motion.div
          animate={{ rotate: 360 }}
          transition={{ repeat: Infinity, duration: 1, ease: "linear" }}
        >
          <Dumbbell className="w-12 h-12 text-emerald-600" />
        </motion.div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-stone-50 dark:bg-stone-950 flex flex-col items-center justify-center p-6 text-center transition-colors duration-300">
        <div className="fixed top-6 left-6">
          <button
            onClick={() => setDarkMode(!darkMode)}
            className="p-3 bg-white dark:bg-stone-900 rounded-2xl shadow-sm border border-stone-200 dark:border-stone-800 text-stone-600 dark:text-stone-400 hover:text-emerald-600 transition-all"
          >
            {darkMode ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
          </button>
        </div>
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="max-w-md w-full bg-white dark:bg-stone-900 rounded-3xl shadow-xl p-10 border border-black/5 dark:border-white/5"
        >
          <div className="w-20 h-20 bg-emerald-100 dark:bg-emerald-900/30 rounded-2xl flex items-center justify-center mx-auto mb-8">
            <Dumbbell className="w-10 h-10 text-emerald-600" />
          </div>
          <h1 className="text-4xl font-bold text-stone-900 dark:text-white mb-4 tracking-tight">FitCoach</h1>
          <p className="text-stone-500 dark:text-stone-400 mb-10 leading-relaxed">
            הפלטפורמה המקצועית לניהול אימונים, מעקב אחר התקדמות ושיתוף תוכניות עבודה.
          </p>
          
          <div className="space-y-4">
            <button
              onClick={() => handleLogin('coach')}
              disabled={loggingIn !== null}
              className="w-full bg-stone-900 dark:bg-white text-white dark:text-stone-900 py-4 rounded-2xl font-semibold flex items-center justify-center gap-3 hover:bg-stone-800 dark:hover:bg-stone-100 transition-all active:scale-95 shadow-lg shadow-stone-200 dark:shadow-none disabled:opacity-50"
            >
              {loggingIn === 'coach' ? (
                <motion.div animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 1, ease: "linear" }}>
                  <Zap className="w-5 h-5 text-emerald-400 dark:text-emerald-600" />
                </motion.div>
              ) : (
                <Users className="w-5 h-5 text-emerald-400 dark:text-emerald-600" />
              )}
              כניסת מאמנים
            </button>
            
            <button
              onClick={() => handleLogin('client')}
              disabled={loggingIn !== null}
              className="w-full bg-white dark:bg-stone-800 text-stone-900 dark:text-white border-2 border-stone-200 dark:border-stone-700 py-4 rounded-2xl font-semibold flex items-center justify-center gap-3 hover:bg-stone-50 dark:hover:bg-stone-700 transition-all active:scale-95 disabled:opacity-50"
            >
              {loggingIn === 'client' ? (
                <motion.div animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 1, ease: "linear" }}>
                  <Zap className="w-5 h-5 text-emerald-600" />
                </motion.div>
              ) : (
                <ClipboardList className="w-5 h-5 text-emerald-600" />
              )}
              כניסת מתאמנים
            </button>
          </div>
        </motion.div>
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="min-h-screen bg-stone-50 dark:bg-stone-950 flex flex-col items-center justify-center p-6 transition-colors duration-300">
        <div className="fixed top-6 left-6">
          <button
            onClick={() => setDarkMode(!darkMode)}
            className="p-3 bg-white dark:bg-stone-900 rounded-2xl shadow-sm border border-stone-200 dark:border-stone-800 text-stone-600 dark:text-stone-400 hover:text-emerald-600 transition-all"
          >
            {darkMode ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
          </button>
        </div>
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="max-w-xl w-full text-center"
        >
          <h2 className="text-3xl font-bold text-stone-900 dark:text-white mb-2">ברוך הבא ל-FitCoach!</h2>
          <p className="text-stone-500 dark:text-stone-400 mb-10">בחר את התפקיד שלך כדי להתחיל:</p>
          
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
            <button
              onClick={() => handleRoleSelection('coach')}
              className="bg-white dark:bg-stone-900 p-8 rounded-3xl border-2 border-transparent hover:border-emerald-500 transition-all group text-right shadow-sm hover:shadow-md"
            >
              <div className="w-14 h-14 bg-emerald-100 dark:bg-emerald-900/30 rounded-2xl flex items-center justify-center mb-6 group-hover:scale-110 transition-transform">
                <Users className="w-7 h-7 text-emerald-600" />
              </div>
              <h3 className="text-xl font-bold text-stone-900 dark:text-white mb-2">אני מאמן</h3>
              <p className="text-stone-500 dark:text-stone-400 text-sm">צור תוכניות אימון, נהל לקוחות ועקוב אחר התקדמות.</p>
            </button>

            <button
              onClick={() => handleRoleSelection('client')}
              className="bg-white dark:bg-stone-900 p-8 rounded-3xl border-2 border-transparent hover:border-emerald-500 transition-all group text-right shadow-sm hover:shadow-md"
            >
              <div className="w-14 h-14 bg-emerald-100 dark:bg-emerald-900/30 rounded-2xl flex items-center justify-center mb-6 group-hover:scale-110 transition-transform">
                <ClipboardList className="w-7 h-7 text-emerald-600" />
              </div>
              <h3 className="text-xl font-bold text-stone-900 dark:text-white mb-2">אני מתאמן</h3>
              <p className="text-stone-500 dark:text-stone-400 text-sm">צפה בתוכניות האימון שהמאמן שלך הכין עבורך.</p>
            </button>
          </div>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-stone-50 dark:bg-stone-950 text-stone-900 dark:text-stone-100 font-sans transition-colors duration-300" dir="rtl">
      <nav className="bg-white dark:bg-stone-900 border-b border-stone-200 dark:border-stone-800 sticky top-0 z-50">
        <div className="max-w-5xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3 cursor-pointer" onClick={() => setView('dashboard')}>
            <div className="w-8 h-8 bg-emerald-600 rounded-lg flex items-center justify-center">
              <Dumbbell className="w-5 h-5 text-white" />
            </div>
            <span className="font-bold text-xl tracking-tight dark:text-white">FitCoach</span>
          </div>
          
          <div className="flex items-center gap-4">
            <button
              onClick={() => setDarkMode(!darkMode)}
              className="p-2 text-stone-400 hover:text-emerald-600 transition-colors"
              title={darkMode ? "מצב יום" : "מצב לילה"}
            >
              {darkMode ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
            </button>
            <div className="hidden sm:block text-left">
              <p className="text-sm font-semibold leading-none dark:text-white">{profile.displayName}</p>
              <p className="text-xs text-stone-500 dark:text-stone-400">{profile.role === 'coach' ? 'מאמן' : 'מתאמן'}</p>
            </div>
            <button
              onClick={handleLogout}
              className="p-2 text-stone-400 hover:text-red-500 transition-colors"
              title="התנתק"
            >
              <LogOut className="w-5 h-5" />
            </button>
          </div>
        </div>
      </nav>

      <main className="max-w-5xl mx-auto p-4 sm:p-6 pb-24">
        {profile.role === 'coach' ? (
          <CoachView 
            profile={profile} 
            view={view} 
            setView={setView} 
            selectedClient={selectedClient}
            setSelectedClient={setSelectedClient}
          />
        ) : (
          <ClientView profile={profile} />
        )}
      </main>
    </div>
  );
}

function ConfirmModal({ isOpen, title, message, onConfirm, onCancel }: { 
  isOpen: boolean, 
  title: string, 
  message: string, 
  onConfirm: () => void, 
  onCancel: () => void 
}) {
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
      <motion.div 
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="bg-white dark:bg-stone-900 rounded-3xl p-8 max-w-sm w-full shadow-2xl text-center border border-stone-100 dark:border-stone-800"
      >
        <div className="w-16 h-16 bg-red-50 dark:bg-red-900/20 rounded-full flex items-center justify-center mx-auto mb-6">
          <Trash2 className="w-8 h-8 text-red-600" />
        </div>
        <h3 className="text-xl font-bold text-stone-900 dark:text-white mb-2">{title}</h3>
        <p className="text-stone-500 dark:text-stone-400 mb-8">{message}</p>
        <div className="flex gap-3">
          <button
            onClick={onConfirm}
            className="flex-1 bg-red-600 text-white py-3 rounded-xl font-bold hover:bg-red-700 transition-all"
          >
            מחק
          </button>
          <button
            onClick={onCancel}
            className="flex-1 bg-stone-100 dark:bg-stone-800 text-stone-900 dark:text-white py-3 rounded-xl font-bold hover:bg-stone-200 dark:hover:bg-stone-700 transition-all"
          >
            ביטול
          </button>
        </div>
      </motion.div>
    </div>
  );
}

function CoachView({ profile, view, setView, selectedClient, setSelectedClient }: { 
  profile: UserProfile, 
  view: string, 
  setView: (v: any) => void,
  selectedClient: UserProfile | null,
  setSelectedClient: (c: UserProfile | null) => void
}) {
  const [clients, setClients] = useState<UserProfile[]>([]);
  const [clientWorkoutsCount, setClientWorkoutsCount] = useState<{ [key: string]: number }>({});
  const [showAddClient, setShowAddClient] = useState(false);
  const [newClientName, setNewClientName] = useState('');
  const [newClientEmail, setNewClientEmail] = useState('');
  const [addingClient, setAddingClient] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [showScheduleModal, setShowScheduleModal] = useState<{ client: UserProfile } | null>(null);
  const [isStandalone, setIsStandalone] = useState(false);

  useEffect(() => {
    setIsStandalone(window.matchMedia('(display-mode: standalone)').matches);
  }, []);

  useEffect(() => {
    const handleMessage = async (event: MessageEvent) => {
      if (event.data?.type === 'GOOGLE_AUTH_SUCCESS') {
        const tokens = event.data.tokens;
        try {
          await updateDoc(doc(db, 'users', profile.uid), {
            googleTokens: tokens
          });
          toast.success('Google Calendar מחובר בהצלחה!');
        } catch (err) {
          handleFirestoreError(err, OperationType.UPDATE, `users/${profile.uid}`);
        }
      }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [profile.uid]);

  const handleConnectGoogle = async () => {
    try {
      const response = await fetch('/api/auth/google/url');
      const { url } = await response.json();
      window.open(url, 'google_auth', 'width=600,height=700');
    } catch (err) {
      console.error('Failed to get Google Auth URL:', err);
      toast.error('נכשל בחיבור ל-Google Calendar');
    }
  };

  useEffect(() => {
    const q = query(collection(db, 'users'), where('role', '==', 'client'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const clientsData = snapshot.docs.map(doc => doc.data() as UserProfile);
      setClients(clientsData);
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    const q = query(collection(db, 'workouts'), where('coachId', '==', profile.uid));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const counts: { [key: string]: number } = {};
      snapshot.docs.forEach(doc => {
        const data = doc.data();
        counts[data.clientId] = (counts[data.clientId] || 0) + 1;
      });
      setClientWorkoutsCount(counts);
    });
    return unsubscribe;
  }, [profile.uid]);

  const handleAddClient = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newClientName || !newClientEmail) return;
    setAddingClient(true);
    try {
      const clientId = newClientEmail.toLowerCase().trim();
      const newClient: UserProfile = {
        uid: clientId,
        email: newClientEmail,
        role: 'client',
        displayName: newClientName,
      };
      await setDoc(doc(db, 'users', clientId), newClient);
      setShowAddClient(false);
      setNewClientName('');
      setNewClientEmail('');
      toast.success('מתאמן נוסף בהצלחה!');
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, 'users');
    } finally {
      setAddingClient(false);
    }
  };

  const handleDeleteClient = async (clientId: string) => {
    try {
      await deleteDoc(doc(db, 'users', clientId));
      setDeleteConfirm(null);
      toast.success('המתאמן הוסר בהצלחה');
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, `users/${clientId}`);
    }
  };

  const filteredClients = clients.filter(c => 
    c.displayName.toLowerCase().includes(searchTerm.toLowerCase()) || 
    c.email.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const totalWorkouts: number = (Object.values(clientWorkoutsCount) as number[]).reduce((a: number, b: number) => a + b, 0);

  if (view === 'create-workout' && selectedClient) {
    return <WorkoutForm coach={profile} client={selectedClient} onCancel={() => setView('dashboard')} onSuccess={(msg) => toast.success(msg)} />;
  }

  if (view === 'templates') {
    return <TemplatesView coach={profile} clients={clients} onBack={() => setView('dashboard')} onSuccess={(msg) => toast.success(msg)} />;
  }

  if (view === 'client-workouts' && selectedClient) {
    return <WorkoutList profile={profile} targetClient={selectedClient} clients={clients} onBack={() => setView('dashboard')} />;
  }

  return (
    <div className="space-y-8">
      <ConfirmModal 
        isOpen={!!deleteConfirm}
        title="מחיקת מתאמן"
        message="האם אתה בטוח שברצונך למחוק את המתאמן? פעולה זו לא תמחוק את האימונים שלו אך תסיר אותו מהרשימה שלך."
        onConfirm={() => deleteConfirm && handleDeleteClient(deleteConfirm)}
        onCancel={() => setDeleteConfirm(null)}
      />

      <header className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h2 className="text-3xl font-bold tracking-tight dark:text-white">הלקוחות שלי</h2>
          <p className="text-stone-500 dark:text-stone-400">נהל את תוכניות האימון של המתאמנים שלך.</p>
        </div>
        <div className="flex flex-wrap gap-3">
          {!isStandalone && (
            <button
              onClick={() => toast.info('כדי להתקין את האפליקציה: 1. לחץ על כפתור השיתוף בדפדפן (ריבוע עם חץ למעלה) 2. בחר "הוסף למסך הבית" (Add to Home Screen)')}
              className="flex items-center gap-2 bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-400 border border-emerald-100 dark:border-emerald-800 px-4 py-2 rounded-xl font-medium hover:bg-emerald-100 dark:hover:bg-emerald-900/30 transition-all"
            >
              <Download className="w-4 h-4" />
              התקן אפליקציה
            </button>
          )}
          <div className="relative">
            <Filter className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-400" />
            <input
              type="text"
              placeholder="חפש מתאמן..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10 pr-4 py-2 bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 rounded-xl text-sm focus:ring-2 focus:ring-emerald-500 outline-none w-48 dark:text-white"
            />
          </div>
          <button
            onClick={handleConnectGoogle}
            className={cn(
              "flex items-center gap-2 px-4 py-2 rounded-xl font-medium transition-all",
              profile.googleTokens 
                ? "bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-400 border border-emerald-100 dark:border-emerald-800" 
                : "bg-white dark:bg-stone-900 text-stone-900 dark:text-white border border-stone-200 dark:border-stone-800 hover:bg-stone-50 dark:hover:bg-stone-800"
            )}
          >
            <Calendar className="w-4 h-4" />
            {profile.googleTokens ? 'Google Calendar מחובר' : 'חבר Google Calendar'}
          </button>
          <button
            onClick={() => setView('templates')}
            className="flex items-center gap-2 bg-white dark:bg-stone-900 text-stone-900 dark:text-white border border-stone-200 dark:border-stone-800 px-4 py-2 rounded-xl font-medium hover:bg-stone-50 dark:hover:bg-stone-800 transition-all"
          >
            <FileText className="w-4 h-4" />
            תבניות אימון
          </button>
          <button
            onClick={() => setShowAddClient(true)}
            className="flex items-center gap-2 bg-stone-900 dark:bg-white text-white dark:text-stone-900 px-4 py-2 rounded-xl font-medium hover:bg-stone-800 dark:hover:bg-stone-100 transition-all"
          >
            <Plus className="w-4 h-4" />
            הוסף מתאמן ידנית
          </button>
          <button
            onClick={() => {
              navigator.clipboard.writeText(window.location.origin);
              toast.success('קישור להרשמה הועתק!');
            }}
            className="flex items-center gap-2 bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-400 px-4 py-2 rounded-xl font-medium hover:bg-emerald-100 dark:hover:bg-emerald-900/30 transition-all"
          >
            <Send className="w-4 h-4" />
            הזמן מתאמן חדש
          </button>
        </div>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white dark:bg-stone-900 p-6 rounded-3xl border border-stone-100 dark:border-stone-800 shadow-sm">
          <div className="flex items-center gap-4 mb-2">
            <div className="w-10 h-10 bg-emerald-50 dark:bg-emerald-900/20 rounded-xl flex items-center justify-center">
              <Users className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
            </div>
            <span className="text-sm font-bold text-stone-500 dark:text-stone-400 uppercase tracking-wider">סה"כ מתאמנים</span>
          </div>
          <div className="text-3xl font-bold dark:text-white">{clients.length}</div>
        </div>
        <div className="bg-white dark:bg-stone-900 p-6 rounded-3xl border border-stone-100 dark:border-stone-800 shadow-sm">
          <div className="flex items-center gap-4 mb-2">
            <div className="w-10 h-10 bg-blue-50 dark:bg-blue-900/20 rounded-xl flex items-center justify-center">
              <Dumbbell className="w-5 h-5 text-blue-600 dark:text-blue-400" />
            </div>
            <span className="text-sm font-bold text-stone-500 dark:text-stone-400 uppercase tracking-wider">סה"כ אימונים</span>
          </div>
          <div className="text-3xl font-bold dark:text-white">
            {totalWorkouts}
          </div>
        </div>
        <div className="bg-white dark:bg-stone-900 p-6 rounded-3xl border border-stone-100 dark:border-stone-800 shadow-sm">
          <div className="flex items-center gap-4 mb-2">
            <div className="w-10 h-10 bg-purple-50 dark:bg-purple-900/20 rounded-xl flex items-center justify-center">
              <Zap className="w-5 h-5 text-purple-600 dark:text-purple-400" />
            </div>
            <span className="text-sm font-bold text-stone-500 dark:text-stone-400 uppercase tracking-wider">ממוצע אימונים ללקוח</span>
          </div>
          <div className="text-3xl font-bold dark:text-white">
            {clients.length > 0 ? (totalWorkouts / clients.length).toFixed(1) : 0}
          </div>
        </div>
      </div>

      {showAddClient && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-white dark:bg-stone-900 rounded-3xl p-8 max-w-md w-full shadow-2xl border border-stone-100 dark:border-stone-800"
          >
            <h3 className="text-2xl font-bold mb-6 dark:text-white">הוספת מתאמן חדש</h3>
            <form onSubmit={handleAddClient} className="space-y-4">
              <div>
                <label className="block text-sm font-semibold text-stone-600 dark:text-stone-400 mb-1">שם מלא</label>
                <input
                  type="text"
                  required
                  value={newClientName}
                  onChange={(e) => setNewClientName(e.target.value)}
                  className="w-full bg-stone-50 dark:bg-stone-800 border border-stone-200 dark:border-stone-700 rounded-xl px-4 py-3 focus:ring-2 focus:ring-emerald-500 outline-none dark:text-white"
                  placeholder="ישראל ישראלי"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-stone-600 dark:text-stone-400 mb-1">אימייל</label>
                <input
                  type="email"
                  required
                  value={newClientEmail}
                  onChange={(e) => setNewClientEmail(e.target.value)}
                  className="w-full bg-stone-50 dark:bg-stone-800 border border-stone-200 dark:border-stone-700 rounded-xl px-4 py-3 focus:ring-2 focus:ring-emerald-500 outline-none dark:text-white"
                  placeholder="israel@example.com"
                />
              </div>
              <div className="flex gap-3 pt-4">
                <button
                  type="submit"
                  disabled={addingClient}
                  className="flex-1 bg-emerald-600 text-white py-3 rounded-xl font-bold hover:bg-emerald-700 transition-all disabled:opacity-50"
                >
                  {addingClient ? 'מוסיף...' : 'הוסף מתאמן'}
                </button>
                <button
                  type="button"
                  onClick={() => setShowAddClient(false)}
                  className="flex-1 bg-stone-100 dark:bg-stone-800 text-stone-900 dark:text-white py-3 rounded-xl font-bold hover:bg-stone-200 dark:hover:bg-stone-700 transition-all"
                >
                  ביטול
                </button>
              </div>
            </form>
          </motion.div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {filteredClients.length === 0 ? (
          <div className="col-span-full py-20 text-center bg-white dark:bg-stone-900 rounded-3xl border border-dashed border-stone-300 dark:border-stone-700">
            <Users className="w-12 h-12 text-stone-300 dark:text-stone-700 mx-auto mb-4" />
            <p className="text-stone-500 dark:text-stone-400 mb-6">לא נמצאו לקוחות התואמים את החיפוש.</p>
            {searchTerm && (
              <button 
                onClick={() => setSearchTerm('')}
                className="text-emerald-600 font-bold hover:underline"
              >
                נקה חיפוש
              </button>
            )}
            {!searchTerm && (
              <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
                <button
                  onClick={() => setShowAddClient(true)}
                  className="bg-stone-900 dark:bg-white text-white dark:text-stone-900 px-6 py-3 rounded-2xl font-bold hover:bg-stone-800 dark:hover:bg-stone-100 transition-all inline-flex items-center gap-2"
                >
                  <Plus className="w-5 h-5" />
                  הוסף את המתאמן הראשון שלך
                </button>
                <button
                  onClick={() => setView('templates')}
                  className="bg-white dark:bg-stone-900 text-stone-900 dark:text-white border border-stone-200 dark:border-stone-800 px-6 py-3 rounded-2xl font-bold hover:bg-stone-50 dark:hover:bg-stone-800 transition-all inline-flex items-center gap-2"
                >
                  <FileText className="w-5 h-5" />
                  בנה תבנית אימון
                </button>
              </div>
            )}
          </div>
        ) : (
          filteredClients.map((client) => (
            <motion.div
              key={client.uid}
              className="bg-white dark:bg-stone-900 p-6 rounded-3xl shadow-sm border border-stone-100 dark:border-stone-800 hover:shadow-md transition-all group relative"
            >
              <button
                onClick={() => setDeleteConfirm(client.uid)}
                className="absolute top-4 left-4 p-2 text-stone-300 dark:text-stone-700 hover:text-red-500 transition-all rounded-full hover:bg-red-50 dark:hover:bg-red-900/20"
                title="מחק מתאמן"
              >
                <Trash2 className="w-4 h-4" />
              </button>

              <div className="flex items-center gap-4 mb-6">
                <div className="w-12 h-12 bg-stone-100 dark:bg-stone-800 rounded-full flex items-center justify-center text-stone-600 dark:text-stone-400 font-bold">
                  {client.displayName[0]}
                </div>
                <div>
                  <h3 className="font-bold text-lg dark:text-white">{client.displayName}</h3>
                  <p className="text-sm text-stone-500 dark:text-stone-400">{client.email}</p>
                </div>
              </div>

              <div className="bg-stone-50 dark:bg-stone-800/50 rounded-2xl p-4 mb-6 flex items-center justify-between">
                <div className="flex items-center gap-2 text-stone-500 dark:text-stone-400">
                  <ClipboardList className="w-4 h-4" />
                  <span className="text-xs font-bold uppercase tracking-wider">תוכניות אימון:</span>
                </div>
                <span className="font-mono font-bold text-emerald-600 dark:text-emerald-400">{clientWorkoutsCount[client.uid] || 0}</span>
              </div>
              
              <div className="flex flex-col gap-2">
                <button
                  onClick={() => setShowScheduleModal({ client: client })}
                  className="w-full py-2.5 bg-stone-100 dark:bg-stone-800 text-stone-900 dark:text-white rounded-xl font-medium flex items-center justify-center gap-2 hover:bg-stone-200 dark:hover:bg-stone-700 transition-colors"
                >
                  <Calendar className="w-4 h-4" />
                  קבע אימון ביומן
                </button>
                <button
                  onClick={() => {
                    setSelectedClient(client);
                    setView('create-workout');
                  }}
                  className="w-full py-2.5 bg-emerald-600 text-white rounded-xl font-medium flex items-center justify-center gap-2 hover:bg-emerald-700 transition-colors"
                >
                  <Plus className="w-4 h-4" />
                  תוכנית חדשה
                </button>
                <button
                  onClick={() => {
                    setSelectedClient(client);
                    setView('client-workouts');
                  }}
                  className="w-full py-2.5 bg-stone-100 dark:bg-stone-800 text-stone-900 dark:text-white rounded-xl font-medium flex items-center justify-center gap-2 hover:bg-stone-200 dark:hover:bg-stone-700 transition-colors"
                >
                  <ClipboardList className="w-4 h-4" />
                  צפה בתוכניות
                </button>
              </div>
            </motion.div>
          ))
        )}
      </div>
        {showScheduleModal && (
        <ScheduleModal 
          client={showScheduleModal.client} 
          coach={profile} 
          onClose={() => setShowScheduleModal(null)}
          onSuccess={(msg) => toast.success(msg)}
        />
      )}
    </div>
  );
}

function ScheduleModal({ client, coach, onClose, onSuccess }: { 
  client: UserProfile, 
  coach: UserProfile, 
  onClose: () => void,
  onSuccess: (msg: string) => void
}) {
  const [title, setTitle] = useState(`אימון עם ${client.displayName}`);
  const [date, setDate] = useState(() => {
    const now = new Date();
    return new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  });
  const [duration, setDuration] = useState(60);
  const [loading, setLoading] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [successEvent, setSuccessEvent] = useState<any>(null);

  const handleSchedule = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!coach.googleTokens) {
      toast.warning('אנא חבר את Google Calendar תחילה');
      return;
    }

    if (!showConfirm) {
      setShowConfirm(true);
      return;
    }

    setLoading(true);
    try {
      const startTime = new Date(date);
      const endTime = new Date(startTime.getTime() + duration * 60000);

      const event = {
        summary: title,
        description: `אימון אישי עם ${client.displayName}`,
        start: {
          dateTime: startTime.toISOString(),
          timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        },
        end: {
          dateTime: endTime.toISOString(),
          timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        },
        attendees: [
          { email: client.email }
        ],
      };

      const response = await fetch('/api/calendar/create-event', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          tokens: coach.googleTokens,
          event,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.details || 'Failed to create event');
      }

      const data = await response.json();
      setSuccessEvent(data);
      onSuccess('האימון נקבע בהצלחה ביומן!');
    } catch (err) {
      console.error('Scheduling error:', err);
      toast.error('נכשל בקביעת האימון. אנא נסה שוב.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="bg-white dark:bg-stone-900 rounded-3xl p-8 max-w-md w-full shadow-2xl border border-stone-100 dark:border-stone-800"
      >
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-2xl font-bold text-stone-900 dark:text-white">
            {successEvent ? 'האימון נקבע!' : 'קביעת אימון ביומן'}
          </h3>
          <button onClick={onClose} className="p-2 hover:bg-stone-100 dark:hover:bg-stone-800 rounded-full transition-colors">
            <X className="w-6 h-6 text-stone-500 dark:text-stone-400" />
          </button>
        </div>

        {successEvent ? (
          <div className="text-center py-4">
            <div className="w-20 h-20 bg-emerald-100 dark:bg-emerald-900/30 rounded-full flex items-center justify-center mx-auto mb-6">
              <Check className="w-10 h-10 text-emerald-600 dark:text-emerald-400" />
            </div>
            <h4 className="text-xl font-bold text-stone-900 dark:text-white mb-2">האימון נוסף ליומן בהצלחה</h4>
            <p className="text-stone-500 dark:text-stone-400 mb-8">
              האימון עם <span className="font-bold text-stone-900 dark:text-white">{client.displayName}</span> נקבע ונוסף ליומן ה-Google שלך.
            </p>
            <div className="flex flex-col gap-3">
              <a
                href={successEvent.htmlLink}
                target="_blank"
                rel="noopener noreferrer"
                className="w-full bg-emerald-600 text-white py-3 rounded-xl font-bold hover:bg-emerald-700 transition-all flex items-center justify-center gap-2"
              >
                <Calendar className="w-5 h-5" />
                צפה ביומן Google
              </a>
              <button
                onClick={onClose}
                className="w-full bg-stone-100 dark:bg-stone-800 text-stone-900 dark:text-white py-3 rounded-xl font-bold hover:bg-stone-200 dark:hover:bg-stone-700 transition-all"
              >
                סגור
              </button>
            </div>
          </div>
        ) : showConfirm ? (
          <div className="text-center py-4">
            <div className="w-16 h-16 bg-emerald-50 dark:bg-emerald-900/20 rounded-full flex items-center justify-center mx-auto mb-6">
              <Calendar className="w-8 h-8 text-emerald-600" />
            </div>
            <h4 className="text-xl font-bold text-stone-900 dark:text-white mb-2">האם אתה בטוח?</h4>
            <p className="text-stone-500 dark:text-stone-400 mb-8">
              אתה עומד לקבוע אימון בשם <span className="font-bold text-stone-900 dark:text-white">"{title}"</span> בתאריך <span className="font-bold text-stone-900 dark:text-white">{new Date(date).toLocaleString('he-IL')}</span>.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => handleSchedule()}
                disabled={loading}
                className="flex-1 bg-emerald-600 text-white py-3 rounded-xl font-bold hover:bg-emerald-700 transition-all disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {loading ? (
                  <motion.div animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 1, ease: "linear" }}>
                    <Zap className="w-5 h-5" />
                  </motion.div>
                ) : (
                  <>אישור וקביעה</>
                )}
              </button>
              <button
                onClick={() => setShowConfirm(false)}
                disabled={loading}
                className="flex-1 bg-stone-100 dark:bg-stone-800 text-stone-900 dark:text-white py-3 rounded-xl font-bold hover:bg-stone-200 dark:hover:bg-stone-700 transition-all"
              >
                חזרה
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSchedule} className="space-y-4">
          <div>
            <label className="block text-sm font-semibold text-stone-600 dark:text-stone-400 mb-1">כותרת האימון</label>
            <input
              type="text"
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full bg-stone-50 dark:bg-stone-800 border border-stone-200 dark:border-stone-700 rounded-xl px-4 py-3 focus:ring-2 focus:ring-emerald-500 outline-none dark:text-white"
            />
          </div>
          <div>
            <label className="block text-sm font-semibold text-stone-600 dark:text-stone-400 mb-1">תאריך ושעה</label>
            <input
              type="datetime-local"
              required
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="w-full bg-stone-50 dark:bg-stone-800 border border-stone-200 dark:border-stone-700 rounded-xl px-4 py-3 focus:ring-2 focus:ring-emerald-500 outline-none dark:text-white"
            />
          </div>
          <div>
            <label className="block text-sm font-semibold text-stone-600 dark:text-stone-400 mb-1">משך זמן (דקות)</label>
            <input
              type="number"
              required
              min="15"
              step="15"
              value={duration}
              onChange={(e) => setDuration(parseInt(e.target.value))}
              className="w-full bg-stone-50 dark:bg-stone-800 border border-stone-200 dark:border-stone-700 rounded-xl px-4 py-3 focus:ring-2 focus:ring-emerald-500 outline-none dark:text-white"
            />
          </div>

          <div className="flex gap-3 pt-4">
            <button
              type="submit"
              disabled={loading}
              className="flex-1 bg-emerald-600 text-white py-3 rounded-xl font-bold hover:bg-emerald-700 transition-all disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {loading ? (
                <motion.div animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 1, ease: "linear" }}>
                  <Zap className="w-5 h-5" />
                </motion.div>
              ) : (
                <>
                  <Calendar className="w-5 h-5" />
                  קבע אימון
                </>
              )}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="flex-1 bg-stone-100 dark:bg-stone-800 text-stone-900 dark:text-white py-3 rounded-xl font-bold hover:bg-stone-200 dark:hover:bg-stone-700 transition-all"
            >
              ביטול
            </button>
          </div>
        </form>
        )}
      </motion.div>
    </div>
  );
}

function TemplatesView({ coach, clients = [], onBack, onSuccess }: { 
  coach: UserProfile, 
  clients?: UserProfile[], 
  onBack: () => void,
  onSuccess?: (msg: string) => void
}) {
  const [templates, setTemplates] = useState<WorkoutTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [sendingTemplate, setSendingTemplate] = useState<WorkoutTemplate | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  useEffect(() => {
    const q = query(collection(db, 'templates'), where('coachId', '==', coach.uid));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const templatesData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as WorkoutTemplate));
      setTemplates(templatesData);
      setLoading(false);
    });
    return unsubscribe;
  }, [coach.uid]);

  const handleDelete = async (id: string) => {
    try {
      await deleteDoc(doc(db, 'templates', id));
      toast.success('התבנית נמחקה בהצלחה');
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, `templates/${id}`);
    }
  };

  const handleSendToClient = async (client: UserProfile) => {
    if (!sendingTemplate) return;
    setIsSending(true);
    try {
      const newWorkoutId = doc(collection(db, 'workouts')).id;
      const newWorkout: Workout = {
        id: newWorkoutId,
        coachId: coach.uid,
        clientId: client.uid,
        title: sendingTemplate.title,
        exercises: sendingTemplate.exercises,
        category: sendingTemplate.category || null,
        goal: sendingTemplate.goal || null,
        intensity: sendingTemplate.intensity || null,
        createdAt: Timestamp.now(),
        isPublic: false,
        shareToken: null,
        expiresAt: null
      };
      await setDoc(doc(db, 'workouts', newWorkoutId), newWorkout);
      toast.success(`התוכנית נשלחה בהצלחה ל${client.displayName}`);
      setSendingTemplate(null);
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, 'workouts');
    } finally {
      setIsSending(false);
    }
  };

  if (showCreate) {
    return <WorkoutForm coach={coach} client={{ uid: 'template', displayName: 'תבנית', email: '', role: 'client' }} onCancel={() => setShowCreate(false)} onSuccess={onSuccess} isTemplateOnly />;
  }

  return (
    <div className="space-y-8">
      <ConfirmModal 
        isOpen={!!deleteConfirm}
        title="מחיקת תבנית"
        message="האם אתה בטוח שברצונך למחוק את התבנית?"
        onConfirm={() => {
          if (deleteConfirm) handleDelete(deleteConfirm);
          setDeleteConfirm(null);
        }}
        onCancel={() => setDeleteConfirm(null)}
      />
      <header className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-bold tracking-tight text-stone-900 dark:text-white">תבניות אימון</h2>
          <p className="text-stone-500 dark:text-stone-400">צור ונהל תבניות אימון לשימוש חוזר.</p>
        </div>
        <div className="flex gap-3">
          <button
            onClick={() => setShowCreate(true)}
            className="bg-stone-900 dark:bg-white text-white dark:text-stone-900 px-4 py-2 rounded-xl font-medium hover:bg-stone-800 dark:hover:bg-stone-100 transition-all flex items-center gap-2"
          >
            <Plus className="w-4 h-4" />
            תבנית חדשה
          </button>
          <button onClick={onBack} className="text-stone-500 hover:text-stone-900 dark:hover:text-white flex items-center gap-1">
            <ChevronRight className="w-5 h-5" />
            חזרה
          </button>
        </div>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {loading ? (
          <div className="col-span-full text-center py-20 text-stone-400">טוען תבניות...</div>
        ) : templates.length === 0 ? (
          <div className="col-span-full py-20 text-center bg-white dark:bg-stone-900 rounded-3xl border border-dashed border-stone-300 dark:border-stone-700">
            <FileText className="w-12 h-12 text-stone-300 dark:text-stone-700 mx-auto mb-4" />
            <p className="text-stone-500 dark:text-stone-400">עדיין אין תבניות שמורות.</p>
          </div>
        ) : (
          templates.map((t) => (
            <div key={t.id} className="bg-white dark:bg-stone-900 p-6 rounded-3xl shadow-sm border border-stone-100 dark:border-stone-800 flex flex-col justify-between">
              <div>
                <h3 className="text-xl font-bold mb-2 text-stone-900 dark:text-white">{t.title}</h3>
                <p className="text-sm text-stone-500 dark:text-stone-400 mb-4">{t.exercises.length} תרגילים</p>
                <div className="flex flex-wrap gap-2">
                  {t.category && <span className="text-[10px] font-bold uppercase bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-400 px-2 py-0.5 rounded-md">{t.category}</span>}
                  {t.goal && <span className="text-[10px] font-bold uppercase bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600 dark:text-emerald-400 px-2 py-0.5 rounded-md">{t.goal}</span>}
                </div>
              </div>
              <div className="mt-6 pt-6 border-t border-stone-50 dark:border-stone-800 flex justify-end gap-2">
                <button
                  onClick={() => setSendingTemplate(t)}
                  className="p-2 text-stone-400 hover:text-emerald-600 transition-colors"
                  title="שלח למתאמן"
                >
                  <Send className="w-5 h-5" />
                </button>
                <button
                  onClick={() => setDeleteConfirm(t.id)}
                  className="p-2 text-stone-300 dark:text-stone-600 hover:text-red-500 transition-colors"
                >
                  <Trash2 className="w-5 h-5" />
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      {sendingTemplate && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-white dark:bg-stone-900 rounded-3xl p-8 max-w-md w-full shadow-2xl border border-stone-100 dark:border-stone-800"
          >
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-2xl font-bold text-stone-900 dark:text-white">שלח תבנית למתאמן</h3>
              <button onClick={() => setSendingTemplate(null)} className="p-2 hover:bg-stone-100 dark:hover:bg-stone-800 rounded-full transition-colors">
                <X className="w-6 h-6 text-stone-500 dark:text-stone-400" />
              </button>
            </div>
            
            <p className="text-stone-500 dark:text-stone-400 mb-6">בחר מתאמן שאליו תרצה לשלוח את התבנית "{sendingTemplate.title}":</p>
            
            <div className="space-y-3 max-h-64 overflow-y-auto pr-2 custom-scrollbar">
              {clients.length === 0 ? (
                <p className="text-center py-4 text-stone-400 dark:text-stone-500 italic">לא נמצאו מתאמנים.</p>
              ) : (
                clients.map(client => (
                  <button
                    key={client.uid}
                    onClick={() => handleSendToClient(client)}
                    disabled={isSending}
                    className="w-full flex items-center justify-between p-4 rounded-2xl border border-stone-100 dark:border-stone-800 hover:border-emerald-200 dark:hover:border-emerald-900/50 hover:bg-emerald-50 dark:hover:bg-emerald-900/10 transition-all group disabled:opacity-50"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 bg-stone-100 dark:bg-stone-800 rounded-full flex items-center justify-center group-hover:bg-emerald-100 dark:group-hover:bg-emerald-900/30 transition-colors">
                        <Users className="w-5 h-5 text-stone-500 dark:text-stone-400 group-hover:text-emerald-600 dark:group-hover:text-emerald-400" />
                      </div>
                      <div className="text-right">
                        <p className="font-bold text-stone-900 dark:text-white">{client.displayName}</p>
                        <p className="text-xs text-stone-500 dark:text-stone-400">{client.email}</p>
                      </div>
                    </div>
                    <ChevronLeft className="w-5 h-5 text-stone-300 dark:text-stone-700 group-hover:text-emerald-500 dark:group-hover:text-emerald-400 transition-colors" />
                  </button>
                ))
              )}
            </div>
            
            <div className="mt-8 flex justify-end">
              <button
                onClick={() => setSendingTemplate(null)}
                className="px-6 py-2 text-stone-500 dark:text-stone-400 font-bold hover:text-stone-900 dark:hover:text-white transition-colors"
              >
                ביטול
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </div>
  );
}

function WorkoutForm({ coach, client, onCancel, onSuccess, isTemplateOnly = false }: { 
  coach: UserProfile, 
  client: UserProfile, 
  onCancel: () => void,
  onSuccess?: (msg: string) => void,
  isTemplateOnly?: boolean
}) {
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState('');
  const [goal, setGoal] = useState('');
  const [intensity, setIntensity] = useState('');
  const [exercises, setExercises] = useState<any[]>([{ id: 'initial-1', name: '', sets: 3, reps: 12, weight: '', rest: '60s', tempo: '', rpe: '', notes: '', instructions: '', videoUrl: '', type: 'main' }]);
  const [saving, setSaving] = useState(false);
  const [templates, setTemplates] = useState<WorkoutTemplate[]>([]);
  const [showTemplates, setShowTemplates] = useState(false);

  useEffect(() => {
    const q = query(collection(db, 'templates'), where('coachId', '==', coach.uid));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const templatesData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as WorkoutTemplate));
      setTemplates(templatesData);
    });
    return unsubscribe;
  }, [coach.uid]);

  const addExercise = () => {
    setExercises([...exercises, { id: Math.random().toString(36).substr(2, 9), name: '', sets: 3, reps: 12, weight: '', rest: '60s', tempo: '', rpe: '', notes: '', instructions: '', videoUrl: '', type: 'main' }]);
  };

  const duplicateExercise = (index: number) => {
    const exerciseToDuplicate = { ...exercises[index], id: Math.random().toString(36).substr(2, 9) };
    const newExercises = [...exercises];
    newExercises.splice(index + 1, 0, exerciseToDuplicate);
    setExercises(newExercises);
  };

  const removeExercise = (index: number) => {
    setExercises(exercises.filter((_, i) => i !== index));
  };

  const updateExercise = (index: number, field: string, value: any) => {
    const newExercises = [...exercises];
    (newExercises[index] as any)[field] = value;
    setExercises(newExercises);
  };

  const handleSaveTemplate = async () => {
    if (!title || exercises.some(ex => !ex.name)) {
      toast.error('נא למלא כותרת ולפחות שם לכל תרגיל לפני שמירה כתבנית');
      return;
    }
    try {
      await addDoc(collection(db, 'templates'), {
        coachId: coach.uid,
        title,
        category,
        goal,
        intensity,
        exercises
      });
      toast.success('התבנית נשמרה בהצלחה!');
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, 'templates');
    }
  };

  const handleLoadTemplate = (template: WorkoutTemplate) => {
    setTitle(template.title);
    setCategory(template.category || '');
    setGoal(template.goal || '');
    setIntensity(template.intensity || '');
    setExercises(template.exercises.map(ex => ({ ...ex, id: ex.id || Math.random().toString(36).substr(2, 9) })));
    setShowTemplates(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title || exercises.some(ex => !ex.name)) {
      toast.error('נא למלא כותרת ולפחות שם לכל תרגיל');
      return;
    }

    setSaving(true);
    try {
      if (isTemplateOnly) {
        await handleSaveTemplate();
        onSuccess?.('התבנית נשמרה בהצלחה!');
        onCancel();
        return;
      }

      const workoutData = {
        coachId: coach.uid,
        clientId: client.uid,
        title,
        category,
        goal,
        intensity,
        exercises,
        isPublic: true,
        createdAt: Timestamp.now(),
      };
      await addDoc(collection(db, 'workouts'), workoutData);
      onSuccess?.('התוכנית נשמרה ושותפה בהצלחה!');
      onCancel();
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, 'workouts');
    } finally {
      setSaving(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="max-w-3xl mx-auto"
    >
      <div className="flex items-center justify-between mb-8">
        <h2 className="text-3xl font-bold tracking-tight text-stone-900 dark:text-white">תוכנית חדשה ל{client.displayName}</h2>
        <div className="flex items-center gap-4">
          <div className="relative">
            <button 
              type="button"
              onClick={() => setShowTemplates(!showTemplates)}
              className="text-stone-500 dark:text-stone-400 hover:text-stone-900 dark:hover:text-white flex items-center gap-1 text-sm font-medium transition-colors"
            >
              <FileText className="w-4 h-4" />
              טען תבנית
            </button>
            {showTemplates && (
              <div className="absolute top-full left-0 mt-2 w-64 bg-white dark:bg-stone-900 rounded-2xl shadow-xl border border-stone-100 dark:border-stone-800 z-50 overflow-hidden">
                <div className="p-4 border-b border-stone-50 dark:border-stone-800 bg-stone-50/50 dark:bg-stone-800/50">
                  <p className="text-xs font-bold text-stone-400 dark:text-stone-500 uppercase tracking-wider">התבניות שלי</p>
                </div>
                <div className="max-h-64 overflow-y-auto">
                  {templates.length === 0 ? (
                    <p className="p-4 text-sm text-stone-400 dark:text-stone-500 text-center">אין תבניות שמורות</p>
                  ) : (
                    templates.map(t => (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() => handleLoadTemplate(t)}
                        className="w-full text-right p-4 hover:bg-stone-50 dark:hover:bg-stone-800 text-sm font-medium transition-colors border-b border-stone-50 dark:border-stone-800 last:border-0 text-stone-900 dark:text-white"
                      >
                        {t.title}
                      </button>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>
          <button onClick={onCancel} className="text-stone-500 dark:text-stone-400 hover:text-stone-900 dark:hover:text-white transition-colors">ביטול</button>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-8">
        <datalist id="common-exercises">
          <option value="סקוואט (Squat)" />
          <option value="לחיצת חזה (Bench Press)" />
          <option value="דדליפט (Deadlift)" />
          <option value="לחיצת כתפיים (Overhead Press)" />
          <option value="מתח (Pull-ups)" />
          <option value="חתירה (Row)" />
          <option value="לאנג'ים (Lunges)" />
          <option value="פלאנק (Plank)" />
          <option value="שכיבות סמיכה (Push-ups)" />
          <option value="כפיפות מרפקים (Bicep Curls)" />
          <option value="פשיטת מרפקים (Tricep Extensions)" />
        </datalist>
        <div className="bg-white dark:bg-stone-900 p-6 rounded-3xl shadow-sm border border-stone-100 dark:border-stone-800 flex items-center justify-between gap-4">
          <div className="flex-1">
            <label className="block text-sm font-semibold text-stone-600 dark:text-stone-400 mb-2">כותרת התוכנית</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="למשל: אימון A - פלג גוף עליון"
              className="w-full text-xl font-bold border-none focus:ring-0 p-0 placeholder:text-stone-300 dark:placeholder:text-stone-700 bg-transparent text-stone-900 dark:text-white"
              autoFocus
            />
          </div>
          <button
            type="button"
            onClick={handleSaveTemplate}
            className="p-3 text-stone-400 dark:text-stone-600 hover:text-emerald-600 dark:hover:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 rounded-xl transition-all"
            title="שמור כתבנית"
          >
            <Save className="w-6 h-6" />
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="bg-white dark:bg-stone-900 p-4 rounded-2xl shadow-sm border border-stone-100 dark:border-stone-800">
            <label className="block text-xs font-bold text-stone-400 dark:text-stone-500 uppercase tracking-wider mb-2 flex items-center gap-1">
              <Tag className="w-3 h-3" /> קטגוריה
            </label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="w-full text-sm font-medium bg-transparent border-none focus:ring-0 p-0 text-stone-900 dark:text-white"
            >
              <option value="" className="dark:bg-stone-900">בחר קטגוריה...</option>
              <option value="Full Body" className="dark:bg-stone-900">Full Body</option>
              <option value="Upper Body" className="dark:bg-stone-900">Upper Body</option>
              <option value="Lower Body" className="dark:bg-stone-900">Lower Body</option>
              <option value="Push" className="dark:bg-stone-900">Push</option>
              <option value="Pull" className="dark:bg-stone-900">Pull</option>
              <option value="Legs" className="dark:bg-stone-900">Legs</option>
              <option value="Core" className="dark:bg-stone-900">Core</option>
              <option value="Cardio" className="dark:bg-stone-900">Cardio</option>
            </select>
          </div>
          <div className="bg-white dark:bg-stone-900 p-4 rounded-2xl shadow-sm border border-stone-100 dark:border-stone-800">
            <label className="block text-xs font-bold text-stone-400 dark:text-stone-500 uppercase tracking-wider mb-2 flex items-center gap-1">
              <Target className="w-3 h-3" /> מטרה
            </label>
            <select
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
              className="w-full text-sm font-medium bg-transparent border-none focus:ring-0 p-0 text-stone-900 dark:text-white"
            >
              <option value="" className="dark:bg-stone-900">בחר מטרה...</option>
              <option value="Strength" className="dark:bg-stone-900">כוח (Strength)</option>
              <option value="Hypertrophy" className="dark:bg-stone-900">היפרטרופיה (Hypertrophy)</option>
              <option value="Endurance" className="dark:bg-stone-900">סיבולת (Endurance)</option>
              <option value="Fat Loss" className="dark:bg-stone-900">ירידה במשקל (Fat Loss)</option>
              <option value="Mobility" className="dark:bg-stone-900">מוביליטי (Mobility)</option>
            </select>
          </div>
          <div className="bg-white dark:bg-stone-900 p-4 rounded-2xl shadow-sm border border-stone-100 dark:border-stone-800">
            <label className="block text-xs font-bold text-stone-400 dark:text-stone-500 uppercase tracking-wider mb-2 flex items-center gap-1">
              <BarChart className="w-3 h-3" /> עצימות
            </label>
            <select
              value={intensity}
              onChange={(e) => setIntensity(e.target.value)}
              className="w-full text-sm font-medium bg-transparent border-none focus:ring-0 p-0 text-stone-900 dark:text-white"
            >
              <option value="" className="dark:bg-stone-900">בחר עצימות...</option>
              <option value="Low" className="dark:bg-stone-900">נמוכה (Low)</option>
              <option value="Medium" className="dark:bg-stone-900">בינונית (Medium)</option>
              <option value="High" className="dark:bg-stone-900">גבוהה (High)</option>
            </select>
          </div>
        </div>

        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-bold text-stone-900 dark:text-white">תרגילים</h3>
            <button
              type="button"
              onClick={addExercise}
              className="text-emerald-600 dark:text-emerald-400 font-semibold flex items-center gap-1 hover:text-emerald-700 dark:hover:text-emerald-300 transition-colors"
            >
              <Plus className="w-4 h-4" />
              הוסף תרגיל
            </button>
          </div>

          <Reorder.Group axis="y" values={exercises} onReorder={setExercises} className="space-y-4">
            {exercises.map((ex, index) => (
              <Reorder.Item
                key={ex.id || index}
                value={ex}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                className="bg-white dark:bg-stone-900 p-6 rounded-3xl shadow-sm border border-stone-100 dark:border-stone-800 relative group"
              >
                <div className="absolute top-4 left-4 flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-all">
                  <div className="p-2 text-stone-300 dark:text-stone-600 cursor-grab active:cursor-grabbing" title="גרור לשינוי סדר">
                    <GripVertical className="w-4 h-4" />
                  </div>
                  <button
                    type="button"
                    onClick={() => duplicateExercise(index)}
                    className="p-2 text-stone-300 dark:text-stone-600 hover:text-emerald-600 dark:hover:text-emerald-400 transition-colors"
                    title="שכפל תרגיל"
                  >
                    <Copy className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => removeExercise(index)}
                    className="p-2 text-stone-300 dark:text-stone-600 hover:text-red-500 transition-colors"
                    title="מחק תרגיל"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 mb-6">
                  <div className="col-span-1 sm:col-span-2">
                    <label className="block text-xs font-bold text-stone-400 dark:text-stone-500 uppercase tracking-wider mb-1">שם התרגיל</label>
                    <input
                      type="text"
                      value={ex.name}
                      onChange={(e) => updateExercise(index, 'name', e.target.value)}
                      placeholder="למשל: לחיצת חזה"
                      list="common-exercises"
                      className="w-full text-lg font-semibold border-b border-stone-100 dark:border-stone-800 focus:border-emerald-500 dark:focus:border-emerald-400 transition-colors py-1 bg-transparent text-stone-900 dark:text-white"
                    />
                  </div>

                  <div className="col-span-1 sm:col-span-2">
                    <div className="flex gap-2">
                      {['warm-up', 'main', 'cool-down'].map((type) => (
                        <button
                          key={type}
                          type="button"
                          onClick={() => updateExercise(index, 'type', type)}
                          className={cn(
                            "flex-1 py-2 rounded-xl text-xs font-bold uppercase tracking-wider transition-all border",
                            ex.type === type 
                              ? "bg-stone-900 dark:bg-white text-white dark:text-stone-900 border-stone-900 dark:border-white" 
                              : "bg-white dark:bg-stone-800 text-stone-400 dark:text-stone-500 border-stone-100 dark:border-stone-700 hover:border-stone-200 dark:hover:border-stone-600"
                          )}
                        >
                          {type === 'warm-up' ? 'Warm-up' : type === 'cool-down' ? 'Cool-down' : 'Main'}
                        </button>
                      ))}
                    </div>
                  </div>
                  
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-bold text-stone-400 dark:text-stone-500 uppercase tracking-wider mb-1">סטים</label>
                      <div className="flex items-center gap-2">
                        <Repeat className="w-4 h-4 text-stone-300 dark:text-stone-700" />
                        <input
                          type="number"
                          value={ex.sets}
                          onChange={(e) => updateExercise(index, 'sets', parseInt(e.target.value))}
                          className="w-full font-mono font-medium bg-transparent text-stone-900 dark:text-white"
                        />
                      </div>
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-stone-400 dark:text-stone-500 uppercase tracking-wider mb-1">חזרות</label>
                      <div className="flex items-center gap-2">
                        <Dumbbell className="w-4 h-4 text-stone-300 dark:text-stone-700" />
                        <input
                          type="number"
                          value={ex.reps}
                          onChange={(e) => updateExercise(index, 'reps', parseInt(e.target.value))}
                          className="w-full font-mono font-medium bg-transparent text-stone-900 dark:text-white"
                        />
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-bold text-stone-400 dark:text-stone-500 uppercase tracking-wider mb-1">משקל</label>
                      <div className="flex items-center gap-2">
                        <Weight className="w-4 h-4 text-stone-300 dark:text-stone-700" />
                        <input
                          type="text"
                          value={ex.weight}
                          onChange={(e) => updateExercise(index, 'weight', e.target.value)}
                          placeholder='למשל: 60 ק"ג'
                          className="w-full font-mono font-medium bg-transparent text-stone-900 dark:text-white"
                        />
                      </div>
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-stone-400 dark:text-stone-500 uppercase tracking-wider mb-1">מנוחה</label>
                      <div className="flex items-center gap-2">
                        <Clock className="w-4 h-4 text-stone-300 dark:text-stone-700" />
                        <input
                          type="text"
                          value={ex.rest}
                          onChange={(e) => updateExercise(index, 'rest', e.target.value)}
                          placeholder="למשל: 90 שניות"
                          className="w-full font-mono font-medium bg-transparent text-stone-900 dark:text-white"
                        />
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-bold text-stone-400 dark:text-stone-500 uppercase tracking-wider mb-1">קצב (Tempo)</label>
                      <div className="flex items-center gap-2">
                        <Zap className="w-4 h-4 text-stone-300 dark:text-stone-700" />
                        <input
                          type="text"
                          value={ex.tempo}
                          onChange={(e) => updateExercise(index, 'tempo', e.target.value)}
                          placeholder="למשל: 3-0-1-0"
                          className="w-full font-mono font-medium bg-transparent text-stone-900 dark:text-white"
                        />
                      </div>
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-stone-400 dark:text-stone-500 uppercase tracking-wider mb-1">מאמץ (RPE)</label>
                      <div className="flex items-center gap-2">
                        <Activity className="w-4 h-4 text-stone-300 dark:text-stone-700" />
                        <input
                          type="number"
                          min="1"
                          max="10"
                          step="0.5"
                          value={ex.rpe}
                          onChange={(e) => updateExercise(index, 'rpe', parseFloat(e.target.value))}
                          placeholder="1-10"
                          className="w-full font-mono font-medium bg-transparent text-stone-900 dark:text-white"
                        />
                      </div>
                    </div>
                  </div>

                  <div className="col-span-1 sm:col-span-2 pt-4 border-t border-stone-50 dark:border-stone-800/50">
                    <div className="flex items-center gap-2 mb-4">
                      <div className="h-px flex-1 bg-stone-100 dark:bg-stone-800"></div>
                      <span className="text-[10px] font-bold text-stone-400 dark:text-stone-500 uppercase tracking-widest px-2">הנחיות ודגשים</span>
                      <div className="h-px flex-1 bg-stone-100 dark:bg-stone-800"></div>
                    </div>

                    <div className="space-y-4">
                      <div>
                        <label className="block text-xs font-bold text-stone-400 dark:text-stone-500 uppercase tracking-wider mb-1 flex items-center gap-1.5">
                          <Video className="w-3 h-3" /> קישור לסרטון (YouTube/Drive)
                        </label>
                        <input
                          type="url"
                          value={ex.videoUrl}
                          onChange={(e) => updateExercise(index, 'videoUrl', e.target.value)}
                          placeholder="הדבק קישור לסרטון הדגמה..."
                          className="w-full text-sm border-b border-stone-100 dark:border-stone-800 focus:border-emerald-500 dark:focus:border-emerald-400 transition-colors py-1 bg-transparent text-stone-900 dark:text-white"
                        />
                      </div>

                      <div>
                        <label className="block text-xs font-bold text-stone-400 dark:text-stone-500 uppercase tracking-wider mb-1 flex items-center gap-1.5">
                          <ClipboardList className="w-3 h-3" /> הוראות ביצוע
                        </label>
                        <textarea
                          value={ex.instructions}
                          onChange={(e) => updateExercise(index, 'instructions', e.target.value)}
                          placeholder="למשל: לרדת לאט, לעצור לשנייה בתחתית..."
                          className="w-full text-sm border-b border-stone-100 dark:border-stone-800 focus:border-emerald-500 dark:focus:border-emerald-400 transition-colors py-1 resize-none h-20 bg-transparent text-stone-900 dark:text-white"
                        />
                      </div>

                      <div>
                        <label className="block text-xs font-bold text-stone-400 dark:text-stone-500 uppercase tracking-wider mb-1 flex items-center gap-1.5">
                          <Info className="w-3 h-3" /> דגשים והערות
                        </label>
                        <textarea
                          value={ex.notes}
                          onChange={(e) => updateExercise(index, 'notes', e.target.value)}
                          placeholder="למשל: לשמור על גב ישר, מרפקים קרובים לגוף..."
                          className="w-full text-sm border-b border-stone-100 dark:border-stone-800 focus:border-emerald-500 dark:focus:border-emerald-400 transition-colors py-1 resize-none h-20 bg-transparent text-stone-900 dark:text-white"
                        />
                      </div>
                    </div>
                  </div>
                </div>
              </Reorder.Item>
            ))}
          </Reorder.Group>
        </div>

        <button
          type="submit"
          disabled={saving}
          className="w-full py-4 bg-stone-900 dark:bg-white text-white dark:text-stone-900 rounded-2xl font-bold text-lg flex items-center justify-center gap-3 hover:bg-stone-800 dark:hover:bg-stone-100 transition-all active:scale-95 disabled:opacity-50"
        >
          {saving ? 'שומר...' : (
            <>
              <Send className="w-5 h-5" />
              שמור ושתף תוכנית
            </>
          )}
        </button>
      </form>
    </motion.div>
  );
}

function WorkoutList({ profile, targetClient, clients = [], onBack }: { 
  profile: UserProfile, 
  targetClient?: UserProfile, 
  clients?: UserProfile[],
  onBack?: () => void 
}) {
  const [workouts, setWorkouts] = useState<Workout[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterCategory, setFilterCategory] = useState('');
  const [filterGoal, setFilterGoal] = useState('');
  const [filterIntensity, setFilterIntensity] = useState('');
  const [sendingWorkout, setSendingWorkout] = useState<Workout | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [deleteWorkoutId, setDeleteWorkoutId] = useState<string | null>(null);
  const [deleteClientId, setDeleteClientId] = useState<boolean>(false);
  const workoutRefs = useRef<{ [key: string]: HTMLDivElement | null }>({});

  useEffect(() => {
    let q;
    if (profile.role === 'coach') {
      if (targetClient) {
        q = query(
          collection(db, 'workouts'),
          where('coachId', '==', profile.uid),
          where('clientId', '==', targetClient.uid)
        );
      } else {
        q = query(
          collection(db, 'workouts'),
          where('coachId', '==', profile.uid)
        );
      }
    } else {
      q = query(
        collection(db, 'workouts'),
        where('clientId', '==', profile.uid)
      );
    }

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const workoutsData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Workout));
      setWorkouts(workoutsData.sort((a, b) => b.createdAt.seconds - a.createdAt.seconds));
      setLoading(false);
    });
    return unsubscribe;
  }, [profile, targetClient]);

  const handleDelete = async (id: string) => {
    try {
      await deleteDoc(doc(db, 'workouts', id));
      setDeleteWorkoutId(null);
      toast.success('התוכנית נמחקה בהצלחה');
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, `workouts/${id}`);
    }
  };

  const handleTogglePublic = async (workout: Workout) => {
    try {
      await updateDoc(doc(db, 'workouts', workout.id), {
        isPublic: !workout.isPublic,
        // If revoking, we might want to clear the expiry date too
        ...(workout.isPublic ? { expiresAt: null } : {})
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `workouts/${workout.id}`);
    }
  };

  const handleSetExpiry = async (workoutId: string, dateStr: string) => {
    try {
      const expiresAt = dateStr ? new Date(dateStr) : null;
      await updateDoc(doc(db, 'workouts', workoutId), {
        expiresAt
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `workouts/${workoutId}`);
    }
  };

  const handleExportPDF = async (workout: Workout) => {
    const element = workoutRefs.current[workout.id];
    if (!element) return;

    try {
      const canvas = await html2canvas(element, {
        scale: 2,
        useCORS: true,
        logging: false,
        backgroundColor: '#ffffff',
        onclone: (clonedDoc) => {
          clonedDoc.documentElement.classList.remove('dark');
        }
      });
      const imgData = canvas.toDataURL('image/png');
      const pdf = new jsPDF('p', 'mm', 'a4');
      const imgProps = pdf.getImageProperties(imgData);
      const pdfWidth = pdf.internal.pageSize.getWidth();
      const pdfHeight = (imgProps.height * pdfWidth) / imgProps.width;
      pdf.addImage(imgData, 'PNG', 0, 0, pdfWidth, pdfHeight);
      pdf.save(`workout-${workout.title}.pdf`);
    } catch (err) {
      console.error('PDF Export error:', err);
      toast.error('שגיאה בייצוא PDF');
    }
  };

  const copyShareLink = (workoutId: string) => {
    const url = `${window.location.origin}/workout/${workoutId}`;
    navigator.clipboard.writeText(url);
    toast.success('הקישור הועתק ללוח!');
  };

  const handleShareEmail = (workout: Workout) => {
    try {
      const subjectText = `תוכנית אימון: ${workout.title}`;
      let bodyText = `היי,\n\nמצורפת תוכנית האימון שלך: ${workout.title}\n\n`;
      
      if (workout.isPublic) {
        const shareLink = `${window.location.origin}/workout/${workout.id}`;
        bodyText += `צפייה בתוכנית המלאה: ${shareLink}\n\n`;
      }

      bodyText += `תרגילים:\n`;
      
      // Hebrew characters encode to 9 characters each in a URL (%XX%XX%XX).
      // Windows and some mail clients have a strict limit of ~2000 characters for mailto URLs.
      // 1000 chars * 9 = 9000 chars - wait, that's too much.
      // Let's use a safer limit. 200 chars * 9 = 1800 chars. 
      // Most modern clients (Gmail, Outlook) handle much more, but for safety:
      const MAX_BODY_CHARS = 400; 
      
      for (let i = 0; i < workout.exercises.length; i++) {
        const ex = workout.exercises[i];
        const exerciseLine = `${i + 1}. ${ex.name} - ${ex.sets}x${ex.reps}${ex.weight ? ` (${ex.weight})` : ''}\n`;
        
        if (bodyText.length + exerciseLine.length < MAX_BODY_CHARS) {
          bodyText += exerciseLine;
        } else {
          bodyText += '...\n';
          break;
        }
      }

      bodyText += `\nבהצלחה!\n${profile.displayName}`;
      
      const encodedSubject = encodeURIComponent(subjectText);
      const encodedBody = encodeURIComponent(bodyText);
      const mailtoLink = `mailto:?subject=${encodedSubject}&body=${encodedBody}`;
      
      // Try the most direct and common method first
      window.location.href = mailtoLink;
      
      // Fallback for some browsers/iframes
      setTimeout(() => {
        try {
          const link = document.createElement('a');
          link.href = mailtoLink;
          link.target = '_blank';
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
        } catch (e) {
          console.error('Fallback email open failed', e);
        }
      }, 500);

      toast.info('פותח את יישום המייל...');
    } catch (err) {
      console.error('Email share error:', err);
      toast.error('שגיאה בפתיחת המייל');
    }
  };

  const handleShareWhatsApp = (workout: Workout) => {
    try {
      let text = `*תוכנית אימון: ${workout.title}*\n\n`;
      
      if (workout.isPublic) {
        const shareLink = `${window.location.origin}/workout/${workout.id}`;
        text += `צפייה בתוכנית המלאה: ${shareLink}\n\n`;
      }

      text += `*תרגילים:*\n`;
      
      // WhatsApp has a much larger limit than mailto, but we still want to keep it concise
      workout.exercises.slice(0, 15).forEach((ex, i) => {
        text += `${i + 1}. ${ex.name} - ${ex.sets}x${ex.reps}${ex.weight ? ` (${ex.weight})` : ''}\n`;
      });
      
      if (workout.exercises.length > 15) {
        text += `...\n`;
      }

      text += `\nבהצלחה!\n${profile.displayName}`;
      
      const whatsappUrl = `https://wa.me/?text=${encodeURIComponent(text)}`;
      
      // Method 1: window.open
      const win = window.open(whatsappUrl, '_blank');
      if (!win) {
        // Method 2: Fallback to location.href if popup blocked
        window.location.href = whatsappUrl;
      }
      
      toast.info('פותח את וואטסאפ...');
    } catch (err) {
      console.error('WhatsApp share error:', err);
      toast.error('שגיאה בשיתוף לוואטסאפ');
    }
  };

  const filteredWorkouts = workouts.filter(w => {
    return (!filterCategory || w.category === filterCategory) &&
           (!filterGoal || w.goal === filterGoal) &&
           (!filterIntensity || w.intensity === filterIntensity);
  });

  const handleSendToClient = async (client: UserProfile) => {
    if (!sendingWorkout) return;
    setIsSending(true);
    try {
      const newWorkoutId = doc(collection(db, 'workouts')).id;
      const newWorkout: Workout = {
        ...sendingWorkout,
        id: newWorkoutId,
        clientId: client.uid,
        createdAt: Timestamp.now(),
        isPublic: false,
        expiresAt: null,
        shareToken: null
      };
      await setDoc(doc(db, 'workouts', newWorkoutId), newWorkout);
      toast.success(`התוכנית נשלחה בהצלחה ל${client.displayName}`);
      setSendingWorkout(null);
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, 'workouts');
    } finally {
      setIsSending(false);
    }
  };

  const handleDeleteClient = async () => {
    if (!targetClient) return;
    try {
      await deleteDoc(doc(db, 'users', targetClient.uid));
      setDeleteClientId(false);
      if (onBack) onBack();
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, `users/${targetClient.uid}`);
    }
  };

  if (loading) return <div className="text-center py-20 text-stone-400">טוען תוכניות...</div>;

  return (
    <div className="space-y-8">
      <ConfirmModal 
        isOpen={!!deleteWorkoutId}
        title="מחיקת תוכנית"
        message="האם אתה בטוח שברצונך למחוק את התוכנית?"
        onConfirm={() => deleteWorkoutId && handleDelete(deleteWorkoutId)}
        onCancel={() => setDeleteWorkoutId(null)}
      />

      <ConfirmModal 
        isOpen={deleteClientId}
        title="מחיקת מתאמן"
        message={`האם אתה בטוח שברצונך למחוק את המתאמן ${targetClient?.displayName}? פעולה זו לא תמחוק את האימונים שלו אך תסיר אותו מהרשימה שלך.`}
        onConfirm={handleDeleteClient}
        onCancel={() => setDeleteClientId(false)}
      />

      <header className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-bold tracking-tight text-stone-900 dark:text-white">
            {targetClient ? `תוכניות עבור ${targetClient.displayName}` : 'תוכניות האימון שלי'}
          </h2>
          <p className="text-stone-500 dark:text-stone-400">
            {workouts.length} תוכניות נמצאו.
          </p>
        </div>
        <div className="flex gap-3">
          {targetClient && profile.role === 'coach' && (
            <button
              onClick={() => setDeleteClientId(true)}
              className="flex items-center gap-2 bg-white dark:bg-stone-900 text-red-600 border border-red-100 dark:border-red-900/30 px-4 py-2 rounded-xl font-medium hover:bg-red-50 dark:hover:bg-red-900/10 transition-all"
            >
              <Trash2 className="w-4 h-4" />
              מחק מתאמן
            </button>
          )}
          {onBack && (
            <button onClick={onBack} className="text-stone-500 dark:text-stone-400 hover:text-stone-900 dark:hover:text-white flex items-center gap-1 transition-colors">
              <ChevronRight className="w-5 h-5" />
              חזרה
            </button>
          )}
        </div>
      </header>

      <div className="flex flex-wrap gap-4 bg-white dark:bg-stone-900 p-4 rounded-2xl shadow-sm border border-stone-100 dark:border-stone-800">
        <div className="flex items-center gap-2 text-stone-400 dark:text-stone-500">
          <Filter className="w-4 h-4" />
          <span className="text-xs font-bold uppercase tracking-wider">סינון:</span>
        </div>
        <select
          value={filterCategory}
          onChange={(e) => setFilterCategory(e.target.value)}
          className="text-xs font-bold bg-stone-50 dark:bg-stone-800 border-none rounded-lg focus:ring-0 px-3 py-1.5 text-stone-900 dark:text-white"
        >
          <option value="" className="dark:bg-stone-900">כל הקטגוריות</option>
          <option value="Full Body" className="dark:bg-stone-900">Full Body</option>
          <option value="Upper Body" className="dark:bg-stone-900">Upper Body</option>
          <option value="Lower Body" className="dark:bg-stone-900">Lower Body</option>
          <option value="Push" className="dark:bg-stone-900">Push</option>
          <option value="Pull" className="dark:bg-stone-900">Pull</option>
          <option value="Legs" className="dark:bg-stone-900">Legs</option>
          <option value="Core" className="dark:bg-stone-900">Core</option>
          <option value="Cardio" className="dark:bg-stone-900">Cardio</option>
        </select>
        <select
          value={filterGoal}
          onChange={(e) => setFilterGoal(e.target.value)}
          className="text-xs font-bold bg-stone-50 dark:bg-stone-800 border-none rounded-lg focus:ring-0 px-3 py-1.5 text-stone-900 dark:text-white"
        >
          <option value="" className="dark:bg-stone-900">כל המטרות</option>
          <option value="Strength" className="dark:bg-stone-900">כוח</option>
          <option value="Hypertrophy" className="dark:bg-stone-900">היפרטרופיה</option>
          <option value="Endurance" className="dark:bg-stone-900">סיבולת</option>
          <option value="Fat Loss" className="dark:bg-stone-900">ירידה במשקל</option>
          <option value="Mobility" className="dark:bg-stone-900">מוביליטי</option>
        </select>
        <select
          value={filterIntensity}
          onChange={(e) => setFilterIntensity(e.target.value)}
          className="text-xs font-bold bg-stone-50 dark:bg-stone-800 border-none rounded-lg focus:ring-0 px-3 py-1.5 text-stone-900 dark:text-white"
        >
          <option value="" className="dark:bg-stone-900">כל העצימויות</option>
          <option value="Low" className="dark:bg-stone-900">נמוכה</option>
          <option value="Medium" className="dark:bg-stone-900">בינונית</option>
          <option value="High" className="dark:bg-stone-900">גבוהה</option>
        </select>
        {(filterCategory || filterGoal || filterIntensity) && (
          <button 
            onClick={() => { setFilterCategory(''); setFilterGoal(''); setFilterIntensity(''); }}
            className="text-xs font-bold text-red-500 hover:text-red-600 transition-colors"
          >
            נקה הכל
          </button>
        )}
      </div>

      <div className="space-y-6">
        {filteredWorkouts.length === 0 ? (
          <div className="py-20 text-center bg-white dark:bg-stone-900 rounded-3xl border border-dashed border-stone-300 dark:border-stone-700">
            <ClipboardList className="w-12 h-12 text-stone-300 dark:text-stone-700 mx-auto mb-4" />
            <p className="text-stone-500 dark:text-stone-400">לא נמצאו תוכניות אימון התואמות את הסינון.</p>
          </div>
        ) : (
          filteredWorkouts.map((workout) => (
            <motion.div
              key={workout.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="bg-white dark:bg-stone-900 rounded-3xl shadow-sm border border-stone-100 dark:border-stone-800 overflow-hidden"
              ref={el => workoutRefs.current[workout.id] = el}
            >
              <div className="p-6 bg-stone-50/50 dark:bg-stone-800/50 border-b border-stone-100 dark:border-stone-800 flex items-center justify-between">
                <div>
                  <h3 className="text-xl font-bold text-stone-900 dark:text-white">{workout.title}</h3>
                  <div className="flex flex-wrap gap-2 mt-1">
                    <p className="text-xs text-stone-400 dark:text-stone-500">
                      נוצר ב-{new Date(workout.createdAt.seconds * 1000).toLocaleDateString('he-IL')}
                    </p>
                    {workout.category && (
                      <span className="text-[10px] font-bold uppercase tracking-wider bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-400 px-2 py-0.5 rounded-md flex items-center gap-1">
                        <Tag className="w-2.5 h-2.5" /> {workout.category}
                      </span>
                    )}
                    {workout.goal && (
                      <span className="text-[10px] font-bold uppercase tracking-wider bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600 dark:text-emerald-400 px-2 py-0.5 rounded-md flex items-center gap-1">
                        <Target className="w-2.5 h-2.5" /> {workout.goal}
                      </span>
                    )}
                    {workout.intensity && (
                      <span className={cn(
                        "text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-md flex items-center gap-1",
                        workout.intensity === 'High' ? "bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400" : 
                        workout.intensity === 'Medium' ? "bg-orange-50 dark:bg-orange-900/20 text-orange-600 dark:text-orange-400" : 
                        "bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400"
                      )}>
                        <BarChart className="w-2.5 h-2.5" /> {workout.intensity}
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {profile.role === 'coach' && (
                    <>
                      <button
                        onClick={() => setSendingWorkout(workout)}
                        className="p-2 text-stone-400 dark:text-stone-500 hover:text-emerald-600 dark:hover:text-emerald-400 transition-all flex flex-col items-center gap-1"
                        title="שלח למתאמן אחר"
                      >
                        <Send className="w-5 h-5" />
                        <span className="text-[10px] font-bold uppercase tracking-wider">שלח</span>
                      </button>
                      <div className="flex flex-col items-end gap-1">
                        <button
                          onClick={() => handleTogglePublic(workout)}
                          className={cn(
                            "p-2 rounded-xl transition-all flex items-center gap-2",
                            workout.isPublic ? "text-emerald-600 bg-emerald-50 dark:bg-emerald-900/20" : "text-stone-300 dark:text-stone-700 hover:text-stone-500 dark:hover:text-stone-400"
                          )}
                          title={workout.isPublic ? "בטל שיתוף (Revoke)" : "שתף (Make Public)"}
                        >
                          <Share2 className="w-5 h-5" />
                          <span className="text-xs font-bold uppercase tracking-wider">
                            {workout.isPublic ? 'ציבורי' : 'פרטי'}
                          </span>
                        </button>
                        {workout.isPublic && (
                          <div className="flex items-center gap-2 mt-1">
                            <div className="flex items-center gap-1 text-[10px] text-stone-400 font-bold uppercase">
                              <Calendar className="w-3 h-3" />
                              תוקף:
                            </div>
                            <input
                              type="datetime-local"
                              defaultValue={workout.expiresAt ? new Date(workout.expiresAt.seconds * 1000 - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16) : ''}
                              onChange={(e) => handleSetExpiry(workout.id, e.target.value)}
                              className="text-[10px] bg-transparent border-none p-0 focus:ring-0 text-stone-600 font-mono"
                            />
                            {workout.expiresAt && (
                              <button 
                                onClick={() => handleSetExpiry(workout.id, '')}
                                className="text-stone-300 hover:text-red-500"
                              >
                                <XCircle className="w-3 h-3" />
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                      {workout.isPublic && (
                        <button
                          onClick={() => copyShareLink(workout.id)}
                          className="p-2 text-stone-400 dark:text-stone-500 hover:text-stone-600 dark:hover:text-stone-300 transition-colors"
                          title="העתק קישור"
                        >
                          <LinkIcon className="w-5 h-5" />
                        </button>
                      )}
                      <button
                        onClick={() => handleExportPDF(workout)}
                        className="p-2 text-stone-400 dark:text-stone-500 hover:text-stone-600 dark:hover:text-stone-300 transition-colors"
                        title="הורד כ-PDF"
                      >
                        <Download className="w-5 h-5" />
                      </button>
                      <button
                        onClick={() => handleShareEmail(workout)}
                        className="p-2 text-stone-400 dark:text-stone-500 hover:text-stone-600 dark:hover:text-stone-300 transition-colors"
                        title="שתף באימייל"
                      >
                        <Mail className="w-5 h-5" />
                      </button>
                      <button
                        onClick={() => handleShareWhatsApp(workout)}
                        className="p-2 text-stone-400 dark:text-stone-500 hover:text-green-600 dark:hover:text-green-400 transition-colors"
                        title="שתף בוואטסאפ"
                      >
                        <MessageCircle className="w-5 h-5" />
                      </button>
                      <button
                        onClick={() => setDeleteWorkoutId(workout.id)}
                        className="p-2 text-stone-300 dark:text-stone-700 hover:text-red-600 dark:hover:text-red-400 transition-colors"
                        title="מחק"
                      >
                        <Trash2 className="w-5 h-5" />
                      </button>
                    </>
                  )}
                  {profile.role === 'client' && (
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => handleExportPDF(workout)}
                        className="p-2 text-stone-400 dark:text-stone-500 hover:text-stone-600 dark:hover:text-stone-300 transition-colors"
                        title="הורד כ-PDF"
                      >
                        <Download className="w-5 h-5" />
                      </button>
                      <button
                        onClick={() => handleShareWhatsApp(workout)}
                        className="p-2 text-stone-400 dark:text-stone-500 hover:text-green-600 dark:hover:text-green-400 transition-colors"
                        title="שתף בוואטסאפ"
                      >
                        <MessageCircle className="w-5 h-5" />
                      </button>
                    </div>
                  )}
                </div>
              </div>
              
              <div className="p-6">
                <div className="grid grid-cols-1 gap-4">
                  {workout.exercises.map((ex, i) => (
                    <div key={i} className="py-4 border-b border-stone-50 dark:border-stone-800 last:border-0">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-4">
                          <div className="w-8 h-8 bg-emerald-50 dark:bg-emerald-900/20 rounded-lg flex items-center justify-center text-emerald-600 dark:text-emerald-400 font-bold text-sm">
                            {i + 1}
                          </div>
                          <span className="font-semibold text-stone-800 dark:text-white">{ex.name}</span>
                        </div>
                        <div className="flex items-center gap-6 text-sm">
                          <div className="flex flex-col items-center">
                            <span className="text-stone-400 dark:text-stone-500 text-[10px] uppercase font-bold">סטים</span>
                            <span className="font-mono font-bold text-stone-900 dark:text-white">{ex.sets}</span>
                          </div>
                          <div className="flex flex-col items-center">
                            <span className="text-stone-400 dark:text-stone-500 text-[10px] uppercase font-bold">חזרות</span>
                            <span className="font-mono font-bold text-stone-900 dark:text-white">{ex.reps}</span>
                          </div>
                          {ex.weight && (
                            <div className="flex flex-col items-center">
                              <span className="text-stone-400 dark:text-stone-500 text-[10px] uppercase font-bold">משקל</span>
                              <span className="font-mono font-bold text-emerald-600 dark:text-emerald-400">{ex.weight}</span>
                            </div>
                          )}
                          {ex.rest && (
                            <div className="flex flex-col items-center">
                              <span className="text-stone-400 dark:text-stone-500 text-[10px] uppercase font-bold">מנוחה</span>
                              <span className="font-mono font-bold text-stone-500 dark:text-stone-400">{ex.rest}</span>
                            </div>
                          )}
                        </div>
                      </div>
                      {(ex.tempo || ex.rpe || ex.notes || ex.instructions || ex.videoUrl || (ex.type && ex.type !== 'main')) && (
                        <div className="mt-3 mr-12 space-y-2">
                          <div className="flex flex-wrap gap-3">
                            {ex.videoUrl && (
                              <a 
                                href={ex.videoUrl} 
                                target="_blank" 
                                rel="noopener noreferrer"
                                className="flex flex-col gap-1 text-xs text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/20 px-3 py-2 rounded-xl border border-emerald-100 dark:border-emerald-900/30 hover:bg-emerald-100 dark:hover:bg-emerald-900/40 transition-colors"
                              >
                                <div className="flex items-center gap-2">
                                  <Video className="w-4 h-4" />
                                  <span className="font-bold">צפה בסרטון הדגמה</span>
                                </div>
                                <span className="text-[10px] opacity-70 font-mono truncate max-w-[200px]">{ex.videoUrl}</span>
                              </a>
                            )}
                            {ex.tempo && (
                              <div className="flex items-center gap-1.5 text-xs text-stone-500 dark:text-stone-400 bg-stone-50 dark:bg-stone-800 px-2 py-1 rounded-lg border border-stone-100 dark:border-stone-700">
                                <Zap className="w-3 h-3 text-stone-400 dark:text-stone-500" />
                                <span className="font-bold">קצב:</span>
                                <span className="font-mono">{ex.tempo}</span>
                              </div>
                            )}
                            {ex.rpe && (
                              <div className="flex items-center gap-1.5 text-xs text-stone-500 dark:text-stone-400 bg-stone-50 dark:bg-stone-800 px-2 py-1 rounded-lg border border-stone-100 dark:border-stone-700">
                                <Activity className="w-3 h-3 text-stone-400 dark:text-stone-500" />
                                <span className="font-bold">RPE:</span>
                                <span className="font-mono">{ex.rpe}</span>
                              </div>
                            )}
                            {ex.type && ex.type !== 'main' && (
                              <div className={cn(
                                "text-[10px] uppercase font-bold px-2 py-1 rounded-lg",
                                ex.type === 'warm-up' ? "bg-orange-50 dark:bg-orange-900/20 text-orange-600 dark:text-orange-400 border border-orange-100 dark:border-orange-900/30" : "bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 border border-blue-100 dark:border-blue-900/30"
                              )}>
                                {ex.type === 'warm-up' ? 'חימום' : 'שחרור'}
                              </div>
                            )}
                          </div>
                          {ex.instructions && (
                            <div className="flex items-start gap-2 text-xs text-stone-500 dark:text-stone-400 bg-emerald-50/30 dark:bg-emerald-900/10 p-3 rounded-2xl border border-emerald-100/50 dark:border-emerald-900/20">
                              <ClipboardList className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 mt-0.5 shrink-0" />
                              <p className="leading-relaxed">{ex.instructions}</p>
                            </div>
                          )}
                          {ex.notes && (
                            <div className="flex items-start gap-2 text-xs text-stone-500 dark:text-stone-400 bg-emerald-50/30 dark:bg-emerald-900/10 p-3 rounded-2xl border border-emerald-100/50 dark:border-emerald-900/20">
                              <Info className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 mt-0.5 shrink-0" />
                              <p className="leading-relaxed">{ex.notes}</p>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </motion.div>
          ))
        )}
      </div>

      {sendingWorkout && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-white dark:bg-stone-900 rounded-3xl p-8 max-w-md w-full shadow-2xl"
          >
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-2xl font-bold text-stone-900 dark:text-white">שלח תוכנית למתאמן</h3>
              <button onClick={() => setSendingWorkout(null)} className="p-2 hover:bg-stone-100 dark:hover:bg-stone-800 rounded-full transition-colors">
                <X className="w-6 h-6 text-stone-900 dark:text-white" />
              </button>
            </div>
            
            <p className="text-stone-500 dark:text-stone-400 mb-6">בחר מתאמן שאליו תרצה לשלוח את התוכנית "{sendingWorkout.title}":</p>
            
            <div className="space-y-3 max-h-64 overflow-y-auto pr-2 custom-scrollbar">
              {clients.length === 0 ? (
                <p className="text-center py-4 text-stone-400 dark:text-stone-500 italic">לא נמצאו מתאמנים.</p>
              ) : (
                clients.map(client => (
                  <button
                    key={client.uid}
                    onClick={() => handleSendToClient(client)}
                    disabled={isSending}
                    className="w-full flex items-center justify-between p-4 rounded-2xl border border-stone-100 dark:border-stone-800 hover:border-emerald-200 dark:hover:border-emerald-900/50 hover:bg-emerald-50 dark:hover:bg-emerald-900/10 transition-all group disabled:opacity-50"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 bg-stone-100 dark:bg-stone-800 rounded-full flex items-center justify-center group-hover:bg-emerald-100 dark:group-hover:bg-emerald-900/30 transition-colors">
                        <Users className="w-5 h-5 text-stone-500 dark:text-stone-400 group-hover:text-emerald-600 dark:group-hover:text-emerald-400" />
                      </div>
                      <div className="text-right">
                        <p className="font-bold text-stone-900 dark:text-white">{client.displayName}</p>
                        <p className="text-xs text-stone-500 dark:text-stone-400">{client.email}</p>
                      </div>
                    </div>
                    <ChevronLeft className="w-5 h-5 text-stone-300 dark:text-stone-700 group-hover:text-emerald-500 dark:group-hover:text-emerald-400 transition-colors" />
                  </button>
                ))
              )}
            </div>
            
            <div className="mt-8 flex justify-end">
              <button
                onClick={() => setSendingWorkout(null)}
                className="px-6 py-2 text-stone-500 font-bold hover:text-stone-900"
              >
                ביטול
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </div>
  );
}

function ClientView({ profile }: { profile: UserProfile }) {
  return <WorkoutList profile={profile} />;
}

function PublicWorkout() {
  const { workoutId } = useParams();
  const [workout, setWorkout] = useState<Workout | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const workoutRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!workoutId) return;

    const fetchWorkout = async () => {
      try {
        const docRef = doc(db, 'workouts', workoutId);
        const docSnap = await getDoc(docRef);
        if (docSnap.exists()) {
          const data = docSnap.data() as Workout;
          const now = new Date();
          const isExpired = data.expiresAt && data.expiresAt.toDate() < now;

          if (data.isPublic && !isExpired) {
            setWorkout({ id: docSnap.id, ...data });
          } else if (isExpired) {
            setError('הקישור לתוכנית זו פג תוקף');
          } else {
            setError('תוכנית זו אינה ציבורית');
          }
        } else {
          setError('תוכנית לא נמצאה');
        }
      } catch (err) {
        console.error(err);
        setError('שגיאה בטעינת התוכנית');
      } finally {
        setLoading(false);
      }
    };

    fetchWorkout();
  }, [workoutId]);

  const handleExportPDF = async () => {
    if (!workout || !workoutRef.current) return;

    try {
      const canvas = await html2canvas(workoutRef.current, {
        scale: 2,
        useCORS: true,
        logging: false,
        backgroundColor: '#ffffff',
        onclone: (clonedDoc) => {
          clonedDoc.documentElement.classList.remove('dark');
        }
      });
      const imgData = canvas.toDataURL('image/png');
      const pdf = new jsPDF('p', 'mm', 'a4');
      const imgProps = pdf.getImageProperties(imgData);
      const pdfWidth = pdf.internal.pageSize.getWidth();
      const pdfHeight = (imgProps.height * pdfWidth) / imgProps.width;
      pdf.addImage(imgData, 'PNG', 0, 0, pdfWidth, pdfHeight);
      pdf.save(`workout-${workout.title}.pdf`);
    } catch (err) {
      console.error('PDF Export error:', err);
      toast.error('שגיאה בייצוא PDF');
    }
  };

  if (loading) return (
    <div className="min-h-screen bg-stone-50 dark:bg-stone-950 flex items-center justify-center">
      <Dumbbell className="w-12 h-12 text-emerald-600 animate-spin" />
    </div>
  );

  if (error || !workout) return (
    <div className="min-h-screen bg-stone-50 dark:bg-stone-950 flex flex-col items-center justify-center p-6 text-center">
      <h2 className="text-2xl font-bold text-stone-900 dark:text-white mb-4">{error || 'שגיאה'}</h2>
      <Link to="/" className="text-emerald-600 dark:text-emerald-400 font-semibold hover:underline">חזרה לדף הבית</Link>
    </div>
  );

  return (
    <div className="min-h-screen bg-stone-50 dark:bg-stone-950 p-6 transition-colors duration-300" dir="rtl">
      <div className="max-w-3xl mx-auto">
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-emerald-600 rounded-lg flex items-center justify-center">
              <Dumbbell className="w-5 h-5 text-white" />
            </div>
            <span className="font-bold text-xl tracking-tight text-stone-900 dark:text-white">FitCoach</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                navigator.clipboard.writeText(window.location.href);
                toast.success('הקישור הועתק!');
              }}
              className="p-2 text-stone-400 dark:text-stone-500 hover:text-stone-600 dark:hover:text-stone-300 transition-colors"
              title="העתק קישור"
            >
              <Copy className="w-5 h-5" />
            </button>
            <button
              onClick={() => {
                const text = `*תוכנית אימון: ${workout.title}*\n\nצפייה בתוכנית המלאה: ${window.location.href}`;
                window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank');
              }}
              className="flex items-center gap-2 bg-green-600 text-white px-4 py-2 rounded-xl font-medium hover:bg-green-700 transition-all"
            >
              <MessageCircle className="w-4 h-4" />
              שתף בוואטסאפ
            </button>
            <button
              onClick={handleExportPDF}
              className="flex items-center gap-2 bg-stone-900 dark:bg-stone-800 text-white px-4 py-2 rounded-xl font-medium hover:bg-stone-800 dark:hover:bg-stone-700 transition-all"
            >
              <Download className="w-4 h-4" />
              הורד כ-PDF
            </button>
          </div>
        </div>

        <div ref={workoutRef} className="bg-white dark:bg-stone-900 rounded-3xl shadow-xl border border-stone-100 dark:border-stone-800 overflow-hidden">
          <div className="p-8 bg-stone-50/50 dark:bg-stone-800/50 border-b border-stone-100 dark:border-stone-800">
            <h1 className="text-3xl font-bold text-stone-900 dark:text-white mb-2">{workout.title}</h1>
            <div className="flex flex-wrap gap-2 mb-2">
              {workout.category && (
                <span className="text-xs font-bold uppercase tracking-wider bg-stone-200 dark:bg-stone-700 text-stone-700 dark:text-stone-300 px-3 py-1 rounded-lg flex items-center gap-1.5">
                  <Tag className="w-3.5 h-3.5" /> {workout.category}
                </span>
              )}
              {workout.goal && (
                <span className="text-xs font-bold uppercase tracking-wider bg-emerald-100 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-400 px-3 py-1 rounded-lg flex items-center gap-1.5">
                  <Target className="w-3.5 h-3.5" /> {workout.goal}
                </span>
              )}
              {workout.intensity && (
                <span className={cn(
                  "text-xs font-bold uppercase tracking-wider px-3 py-1 rounded-lg flex items-center gap-1.5",
                  workout.intensity === 'High' ? "bg-red-100 dark:bg-red-900/20 text-red-700 dark:text-red-400" : 
                  workout.intensity === 'Medium' ? "bg-orange-100 dark:bg-orange-900/20 text-orange-700 dark:text-orange-400" : 
                  "bg-blue-100 dark:bg-blue-900/20 text-blue-700 dark:text-blue-400"
                )}>
                  <BarChart className="w-3.5 h-3.5" /> {workout.intensity}
                </span>
              )}
            </div>
            <p className="text-stone-500 dark:text-stone-400">תוכנית אימון מקצועית מבית FitCoach</p>
          </div>
          <div className="p-8">
            <div className="space-y-6">
              {workout.exercises.map((ex, i) => (
                <div key={i} className="py-6 border-b border-stone-50 dark:border-stone-800/50 last:border-0">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div className="flex items-center gap-4">
                      <div className="w-10 h-10 bg-emerald-50 dark:bg-emerald-900/20 rounded-xl flex items-center justify-center text-emerald-600 dark:text-emerald-400 font-bold">
                        {i + 1}
                      </div>
                      <span className="text-xl font-bold text-stone-800 dark:text-stone-200">{ex.name}</span>
                    </div>
                    <div className="flex items-center gap-8">
                      <div className="text-center">
                        <p className="text-[10px] uppercase font-bold text-stone-400 dark:text-stone-500 mb-1">סטים</p>
                        <p className="text-lg font-mono font-bold text-stone-900 dark:text-white">{ex.sets}</p>
                      </div>
                      <div className="text-center">
                        <p className="text-[10px] uppercase font-bold text-stone-400 dark:text-stone-500 mb-1">חזרות</p>
                        <p className="text-lg font-mono font-bold text-stone-900 dark:text-white">{ex.reps}</p>
                      </div>
                      {ex.weight && (
                        <div className="text-center">
                          <p className="text-[10px] uppercase font-bold text-stone-400 dark:text-stone-500 mb-1">משקל</p>
                          <p className="text-lg font-mono font-bold text-emerald-600 dark:text-emerald-400">{ex.weight}</p>
                        </div>
                      )}
                      {ex.rest && (
                        <div className="text-center">
                          <p className="text-[10px] uppercase font-bold text-stone-400 dark:text-stone-500 mb-1">מנוחה</p>
                          <p className="text-lg font-mono font-bold text-stone-500 dark:text-stone-400">{ex.rest}</p>
                        </div>
                      )}
                    </div>
                  </div>
                  {(ex.tempo || ex.rpe || ex.notes || ex.instructions || ex.videoUrl || (ex.type && ex.type !== 'main')) && (
                    <div className="mt-4 mr-14 space-y-3">
                      <div className="flex flex-wrap gap-4">
                        {ex.videoUrl && (
                          <a 
                            href={ex.videoUrl} 
                            target="_blank" 
                            rel="noopener noreferrer"
                            className="flex flex-col gap-1 text-sm text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/20 px-4 py-3 rounded-2xl border border-emerald-100 dark:border-emerald-900/30 hover:bg-emerald-100 dark:hover:bg-emerald-900/40 transition-colors"
                          >
                            <div className="flex items-center gap-2">
                              <Video className="w-5 h-5" />
                              <span className="font-bold">צפה בסרטון הדגמה</span>
                            </div>
                            <span className="text-xs opacity-70 font-mono break-all">{ex.videoUrl}</span>
                          </a>
                        )}
                        {ex.tempo && (
                          <div className="flex items-center gap-2 text-sm text-stone-600 dark:text-stone-400 bg-stone-100 dark:bg-stone-800 px-3 py-1.5 rounded-xl">
                            <Zap className="w-4 h-4 text-stone-400 dark:text-stone-500" />
                            <span className="font-bold">קצב:</span>
                            <span className="font-mono">{ex.tempo}</span>
                          </div>
                        )}
                        {ex.rpe && (
                          <div className="flex items-center gap-2 text-sm text-stone-600 dark:text-stone-400 bg-stone-100 dark:bg-stone-800 px-3 py-1.5 rounded-xl">
                            <Activity className="w-4 h-4 text-stone-400 dark:text-stone-500" />
                            <span className="font-bold">RPE:</span>
                            <span className="font-mono">{ex.rpe}</span>
                          </div>
                        )}
                        {ex.type && ex.type !== 'main' && (
                          <div className={cn(
                            "text-xs uppercase font-bold px-3 py-1.5 rounded-xl",
                            ex.type === 'warm-up' ? "bg-orange-100 dark:bg-orange-900/20 text-orange-700 dark:text-orange-400" : "bg-blue-100 dark:bg-blue-900/20 text-blue-700 dark:text-blue-400"
                          )}>
                            {ex.type === 'warm-up' ? 'חימום' : 'שחרור'}
                          </div>
                        )}
                      </div>
                      {ex.instructions && (
                        <div className="flex items-start gap-3 text-sm text-stone-600 dark:text-stone-400 bg-emerald-50 dark:bg-emerald-900/10 p-4 rounded-2xl border border-emerald-100 dark:border-emerald-900/20">
                          <ClipboardList className="w-5 h-5 text-emerald-600 dark:text-emerald-500 mt-0.5 shrink-0" />
                          <p className="leading-relaxed">{ex.instructions}</p>
                        </div>
                      )}
                      {ex.notes && (
                        <div className="flex items-start gap-3 text-sm text-stone-600 dark:text-stone-400 bg-emerald-50 dark:bg-emerald-900/10 p-4 rounded-2xl border border-emerald-100 dark:border-emerald-900/20">
                          <Info className="w-5 h-5 text-emerald-600 dark:text-emerald-500 mt-0.5 shrink-0" />
                          <p className="leading-relaxed">{ex.notes}</p>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
        
        <p className="text-center text-stone-400 dark:text-stone-600 mt-12 text-sm">
          נוצר באמצעות FitCoach - הפלטפורמה למאמני כושר
        </p>
      </div>
    </div>
  );
}
