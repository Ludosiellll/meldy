import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { lazy, Suspense, type ComponentType } from 'react';
import { Toaster } from 'react-hot-toast';
import { useAuth } from './hooks/useAuth';
import Layout from './components/Layout';
import PWAUpdater from './components/PWAUpdater';
import RouteLoading from './components/RouteLoading';
import { ProWindowProvider } from './components/pro/ProWindow';
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
const MistakeDiary = lazy(() => import('./pages/MistakeDiary'));
const Analytics = lazy(() => import('./pages/Analytics'));
const KnowledgeMap = lazy(() => import('./pages/KnowledgeMap'));
const AuthCallback = lazy(() => import('./pages/AuthCallback'));
const Profile = lazy(() => import('./pages/Profile'));
const SharedMaterial = lazy(() => import('./pages/SharedMaterial'));
const Exams = lazy(() => import('./pages/Exams'));
const ExamEditor = lazy(() => import('./pages/ExamEditor'));
const ExamDetail = lazy(() => import('./pages/ExamDetail'));
const ExamDraw = lazy(() => import('./pages/ExamDraw'));
const ExamTicket = lazy(loadExamTicket);
const TryExample = lazy(() => import('./pages/TryExample'));
const Check = lazy(() => import('./pages/Check'));

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

function PrivateRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <RouteLoading />;
  return user ? <>{children}</> : <Navigate to="/login" replace />;
}

export default function App() {
  return (
    <BrowserRouter>
      <PWAUpdater />
      <ProWindowProvider />
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
        <Route path="/check" element={<Check />} />
        <Route path="/" element={
          <PrivateRoute><Layout /></PrivateRoute>
        }>
          <Route path="dashboard" element={<Dashboard />} />
          <Route path="profile" element={<Profile />} />
          <Route path="analyze" element={<Analyze />} />
          <Route path="library" element={<Library />} />
          <Route path="library/:id" element={<MaterialDetail />} />
          <Route path="review" element={<Review />} />
          <Route path="exams" element={<Exams />} />
          <Route path="exams/new" element={<ExamEditor />} />
          <Route path="exams/:id" element={<ExamDetail />} />
          <Route path="exams/:id/edit" element={<ExamEditor />} />
          <Route path="exams/:id/draw" element={<ExamDraw />} />
          <Route path="exams/:id/ticket" element={<ExamTicket />} />
          <Route path="mistakes" element={<MistakeDiary />} />
          <Route path="analytics" element={<Analytics />} />
          <Route path="knowledge-map" element={<KnowledgeMap />} />
        </Route>
        <Route path="/shared/:id" element={<SharedMaterial />} />
        <Route path="/auth/callback" element={<AuthCallback />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      </Suspense>
    </BrowserRouter>
  );
}
