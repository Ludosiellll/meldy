import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './hooks/useAuth';
import Layout from './components/Layout';
import Landing from './pages/Landing';
import Login from './pages/Login';
import Register from './pages/Register';
import Dashboard from './pages/Dashboard';
import Analyze from './pages/Analyze';
import Library from './pages/Library';
import MaterialDetail from './pages/MaterialDetail';
import Review from './pages/Review';
import Planner from './pages/Planner';
import Chat from './pages/Chat';
import ProfessorExam from './pages/ProfessorExam';
import Missions from './pages/Missions';
import MistakeDiary from './pages/MistakeDiary';
import MoodTracker from './pages/MoodTracker';
import Analytics from './pages/Analytics';
import QuickPrep from './pages/QuickPrep';
import KnowledgeMap from './pages/KnowledgeMap';
import AuthCallback from './pages/AuthCallback';

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
        <Route path="/" element={
          <PrivateRoute><Layout /></PrivateRoute>
        }>
          <Route path="dashboard" element={<Dashboard />} />
          <Route path="analyze" element={<Analyze />} />
          <Route path="library" element={<Library />} />
          <Route path="library/:id" element={<MaterialDetail />} />
          <Route path="review" element={<Review />} />
          <Route path="planner" element={<Planner />} />
          <Route path="chat" element={<Chat />} />
          <Route path="exam" element={<ProfessorExam />} />
          <Route path="play" element={<Missions />} />
          <Route path="mistakes" element={<MistakeDiary />} />
          <Route path="mood" element={<MoodTracker />} />
          <Route path="analytics" element={<Analytics />} />
          <Route path="quick-prep" element={<QuickPrep />} />
          <Route path="knowledge-map" element={<KnowledgeMap />} />
        </Route>
        <Route path="/auth/callback" element={<AuthCallback />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
