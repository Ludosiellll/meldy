import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { lazy, Suspense, useEffect, useState, type ComponentType } from 'react';
import { Toaster } from 'react-hot-toast';
import { useAuth } from './hooks/useAuth';
import PWAUpdater from './components/PWAUpdater';
import RouteLoading from './components/RouteLoading';
import IdlePrefetch from './components/IdlePrefetch';
import { ProWindowProvider } from './components/pro/ProWindow';
import { layoutPart, preloadSignedInScreen } from './lib/prefetch';
import { useLazyPart } from './lib/lazyPart';
// The guide's styles stay in the first stylesheet, ahead of the kit, where they were before the shell
// became a file of its own: with equal weight, the kit's hover and current-page look of «Добавить
// лекцию» still wins over the guide's yellow ring.
import './components/guide/guide.css';
// Fonts and kit tokens for every route (Onest only since the 2026-10-04 redesign): the app does not
// load fonts from a third-party host, which the production CSP blocks.
import './styles/paper.css';

const Landing = lazy(() => import('./pages/Landing'));
const Login = lazy(() => import('./pages/Login'));
const Register = lazy(() => import('./pages/Register'));
const ForgotPassword = lazy(() => import('./pages/ForgotPassword'));
const UpdatePassword = lazy(() => import('./pages/UpdatePassword'));
const Dashboard = lazy(() => import('./pages/Dashboard'));
const Analyze = lazy(() => import('./pages/Analyze'));
const Library = lazy(() => import('./pages/Library'));
const MaterialDetail = lazy(() => import('./pages/MaterialDetail'));
const Review = lazy(() => import('./pages/Review'));
const Courses = lazy(() => import('./pages/Courses'));
const Chat = lazy(() => import('./pages/Chat'));
const ProfessorExam = lazy(() => import('./pages/ProfessorExam'));
const Missions = lazy(() => import('./pages/Missions'));
const MistakeDiary = lazy(() => import('./pages/MistakeDiary'));
const MoodTracker = lazy(() => import('./pages/MoodTracker'));
const Analytics = lazy(() => import('./pages/Analytics'));
const KnowledgeMap = lazy(() => import('./pages/KnowledgeMap'));
const AuthCallback = lazy(() => import('./pages/AuthCallback'));
const HHCallback = lazy(() => import('./pages/HHCallback'));
const SocialHub = lazy(() => import('./pages/SocialHub'));
const CoStudy = lazy(() => import('./pages/CoStudy'));
const Career = lazy(() => import('./pages/Career'));
const StudySession = lazy(() => import('./pages/StudySession'));
const Profile = lazy(() => import('./pages/Profile'));
const Messages = lazy(() => import('./pages/Messages'));
const TeacherDashboard = lazy(() => import('./pages/TeacherDashboard'));
const Pricing = lazy(() => import('./pages/Pricing'));
const ShortsPlayer = lazy(() => import('./pages/ShortsPlayer'));
const SharedMaterial = lazy(() => import('./pages/SharedMaterial'));
const AssignmentView = lazy(() => import('./pages/AssignmentView'));
const Exams = lazy(() => import('./pages/Exams'));
const ExamEditor = lazy(() => import('./pages/ExamEditor'));
const ExamDetail = lazy(() => import('./pages/ExamDetail'));
const ExamDraw = lazy(() => import('./pages/ExamDraw'));
const ExamTicket = lazy(loadExamTicket);
const TryExample = lazy(() => import('./pages/TryExample'));

/**
 * The answer screen («Ответ вслух», /exams/:id/ticket) is built by its own package. The glob keeps
 * this file building in a checkout where that page has not landed yet; once it exists it is an
 * ordinary lazy chunk.
 */
function loadExamTicket(): Promise<{ default: ComponentType }> {
  const pages = import.meta.glob<{ default: ComponentType }>('./pages/ExamTicket.tsx');
  const load = pages['./pages/ExamTicket.tsx'];
  return load ? load() : Promise.resolve({ default: TicketUnavailable });
}

function TicketUnavailable() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--sf-canvas)] px-6 text-center text-[var(--sf-ink)]">
      <p className="max-w-md text-base">Экран ответа пока недоступен в этой сборке. Вернитесь к листу экзамена.</p>
    </div>
  );
}

/**
 * The signed-in shell (menu, guide) is a file of its own: the landing, sign-in and /try do not carry
 * it. The page loader stays until it has arrived. It renders without suspending, so the page inside
 * it shows as soon as the page is in (React holds back a Suspense retry that suspends once more).
 */
function SignedInShell() {
  const [failure, setFailure] = useState<{ error: unknown } | null>(null);
  const Layout = useLazyPart(layoutPart, true, { onError: (error) => setFailure({ error }) });
  // Like a page whose file did not load: the error goes to the boundary above.
  if (failure) throw failure.error;
  return Layout ? <Layout /> : <RouteLoading />;
}

function PrivateRoute({ children }: { children: React.ReactNode }) {
  const { user, loading, requestSession } = useAuth();
  const { pathname } = useLocation();
  // While the session is checked, the shell and the page start loading together (lib/prefetch.ts).
  useEffect(() => {
    requestSession?.();
    preloadSignedInScreen(pathname);
    // Only on entering the signed-in part: inside it, pages load with the shell already in place.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  if (loading) return <RouteLoading />;
  return user ? <>{children}</> : <Navigate to="/login" replace />;
}

export default function App() {
  return (
    <BrowserRouter>
      <PWAUpdater />
      <ProWindowProvider />
      <IdlePrefetch />
      <Toaster 
        position="top-right" 
        toastOptions={{ 
          duration: 4000, 
          style: {
            background: 'var(--toast-bg)',
            color: 'var(--toast-color)',
            border: '1px solid var(--toast-border)',
            borderRadius: '20px',
            boxShadow: 'var(--toast-shadow)',
            padding: '14px 18px',
            fontSize: '15px',
            fontWeight: 500,
            fontFamily: 'var(--ph-sans)',
          }
        }} 
      />
      <Suspense fallback={<RouteLoading />}>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
        <Route path="/forgot-password" element={<ForgotPassword />} />
        <Route path="/update-password" element={<UpdatePassword />} />
        <Route path="/try/*" element={<TryExample />} />
        <Route path="/" element={
          <PrivateRoute><SignedInShell /></PrivateRoute>
        }>
          <Route path="dashboard" element={<Dashboard />} />
          <Route path="network" element={<SocialHub />} />
          <Route path="career" element={<Career />} />
          <Route path="profile" element={<Profile />} />
          <Route path="profile/:id" element={<Profile />} />
          <Route path="messages" element={<Messages />} />
          <Route path="messages/:id" element={<Messages />} />
          <Route path="analyze" element={<Analyze />} />
          <Route path="library" element={<Library />} />
          <Route path="library/:id" element={<MaterialDetail />} />
          <Route path="assignment/:id" element={<AssignmentView />} />
          <Route path="co-study/:id" element={<CoStudy />} />
          <Route path="review" element={<Review />} />
          <Route path="exams" element={<Exams />} />
          <Route path="exams/new" element={<ExamEditor />} />
          <Route path="exams/:id" element={<ExamDetail />} />
          <Route path="exams/:id/edit" element={<ExamEditor />} />
          <Route path="exams/:id/draw" element={<ExamDraw />} />
          <Route path="exams/:id/ticket" element={<ExamTicket />} />
          <Route path="study-session" element={<StudySession />} />
          <Route path="planner" element={<Navigate to="/courses" replace />} />
          <Route path="courses" element={<Courses />} />
          <Route path="chat" element={<Chat />} />
          <Route path="exam" element={<ProfessorExam />} />
          <Route path="play" element={<Missions />} />
          <Route path="mistakes" element={<MistakeDiary />} />
          <Route path="mood" element={<MoodTracker />} />
          <Route path="analytics" element={<Analytics />} />
          <Route path="quick-prep" element={<Navigate to="/library" replace />} />
          <Route path="knowledge-map" element={<KnowledgeMap />} />
          <Route path="teacher" element={<TeacherDashboard />} />
          <Route path="pricing" element={<Pricing />} />
        </Route>
        <Route path="/shorts/:id" element={
          <PrivateRoute><ShortsPlayer /></PrivateRoute>
        } />
        <Route path="/shared/:id" element={<SharedMaterial />} />
        <Route path="/auth/callback" element={<AuthCallback />} />
        <Route path="/hh-callback" element={<PrivateRoute><HHCallback /></PrivateRoute>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      </Suspense>
    </BrowserRouter>
  );
}
