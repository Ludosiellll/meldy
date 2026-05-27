import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './hooks/useAuth';
import Layout from './components/Layout';
import Landing from './pages/Landing';
import Login from './pages/Login';
import Register from './pages/Register';
import ForgotPassword from './pages/ForgotPassword';
import UpdatePassword from './pages/UpdatePassword';
import Dashboard from './pages/Dashboard';
import Analyze from './pages/Analyze';
import Library from './pages/Library';
import MaterialDetail from './pages/MaterialDetail';
import Review from './pages/Review';
import Planner from './pages/Planner';
import Courses from './pages/Courses';
import Chat from './pages/Chat';
import ProfessorExam from './pages/ProfessorExam';
import Missions from './pages/Missions';
import MistakeDiary from './pages/MistakeDiary';
import MoodTracker from './pages/MoodTracker';
import Analytics from './pages/Analytics';
import QuickPrep from './pages/QuickPrep';
import KnowledgeMap from './pages/KnowledgeMap';
import AuthCallback from './pages/AuthCallback';
import SocialHub from './pages/SocialHub';
import CoStudy from './pages/CoStudy';
import Career from './pages/Career';
import Profile from './pages/Profile';
import Messages from './pages/Messages';
import TeacherDashboard from './pages/TeacherDashboard';
import Pricing from './pages/Pricing';
import PWAUpdater from './components/PWAUpdater';
import InstallPWA from './components/InstallPWA';

import { Smartphone } from 'lucide-react';

function PrivateRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return (
    <div className="min-h-screen bg-slate-900 flex items-center justify-center">
      <div className="w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
    </div>
  );
  return user ? <>{children}</> : <Navigate to="/login" replace />;
}

const PortraitLock = () => (
  <div className="portrait-lock fixed inset-0 z-[99999] bg-slate-950 flex-col items-center justify-center p-6 text-center text-white hidden">
    <Smartphone className="w-16 h-16 text-indigo-500 mb-6 animate-pulse" style={{ transform: 'rotate(90deg)' }} />
    <h2 className="text-2xl font-black mb-3 text-slate-100">Переверните устройство</h2>
    <p className="text-slate-400 max-w-sm mx-auto leading-relaxed">
      Пожалуйста, используйте вертикальную ориентацию экрана для корректной работы с платформой.
    </p>
  </div>
);

import { Toaster } from 'react-hot-toast';

export default function App() {
  return (
    <BrowserRouter>
      <PWAUpdater />
      <InstallPWA />
      <PortraitLock />
      <Toaster position="top-center" toastOptions={{ duration: 4000, style: { background: '#1e293b', color: '#fff', borderRadius: '12px' } }} />
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
          <Route path="analyze" element={<Analyze />} />
          <Route path="library" element={<Library />} />
          <Route path="library/:id" element={<MaterialDetail />} />
          <Route path="co-study/:id" element={<CoStudy />} />
          <Route path="review" element={<Review />} />
          <Route path="planner" element={<Navigate to="/courses" replace />} />
          <Route path="courses" element={<Courses />} />
          <Route path="chat" element={<Chat />} />
          <Route path="exam" element={<ProfessorExam />} />
          <Route path="play" element={<Missions />} />
          <Route path="mistakes" element={<MistakeDiary />} />
          <Route path="mood" element={<MoodTracker />} />
          <Route path="analytics" element={<Analytics />} />
          <Route path="quick-prep" element={<QuickPrep />} />
          <Route path="knowledge-map" element={<KnowledgeMap />} />
          <Route path="teacher" element={<TeacherDashboard />} />
          <Route path="pricing" element={<Pricing />} />
        </Route>
        <Route path="/auth/callback" element={<AuthCallback />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
