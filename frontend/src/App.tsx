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

function PrivateRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return (
    <div className="min-h-screen bg-slate-900 flex items-center justify-center">
      <div className="w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
    </div>
  );
  return user ? <>{children}</> : <Navigate to="/login" replace />;
}

export default function App() {
  return (
    <BrowserRouter>
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
        </Route>
        <Route path="/auth/callback" element={<AuthCallback />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
