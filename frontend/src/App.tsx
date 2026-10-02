import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { lazy, Suspense } from 'react';
import { useAuth } from './hooks/useAuth';
import Layout from './components/Layout';
import PWAUpdater from './components/PWAUpdater';

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

function PrivateRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return (
    <div className="min-h-screen bg-slate-900 flex items-center justify-center">
      <div className="w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
    </div>
  );
  return user ? <>{children}</> : <Navigate to="/login" replace />;
}

import { Toaster } from 'react-hot-toast';

export default function App() {
  return (
    <BrowserRouter>
      <PWAUpdater />
      <Toaster 
        position="top-right" 
        toastOptions={{ 
          duration: 4000, 
          style: {
            background: 'var(--toast-bg)',
            color: 'var(--toast-color)',
            border: '1px solid var(--toast-border)',
            borderRadius: '16px',
            boxShadow: 'var(--toast-shadow)',
            padding: '12px 16px',
            fontSize: '13px',
            fontWeight: 600,
            fontFamily: "'Inter', sans-serif",
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
        <Route path="/" element={
          <PrivateRoute><Layout /></PrivateRoute>
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

function RouteLoading() {
  return (
    <div className="min-h-screen bg-[#07111f] flex items-center justify-center text-slate-300">
      <div className="flex flex-col items-center gap-3" role="status" aria-label="Загрузка страницы">
        <div className="h-8 w-8 rounded-full border-2 border-cyan-300 border-t-transparent animate-spin" />
        <span className="text-xs tracking-wide">Загружаем страницу…</span>
      </div>
    </div>
  );
}
