import { BrowserRouter, Routes, Route, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { lazy, Suspense, useEffect, useState, type ComponentType } from 'react';
import { Toaster } from 'react-hot-toast';
import { useAuth } from './hooks/useAuth';
import PWAUpdater from './components/PWAUpdater';
import RouteLoading from './components/RouteLoading';
import IdlePrefetch from './components/IdlePrefetch';
import { ProWindowProvider } from './components/pro/ProWindow';
import { layoutPart, preloadSignedInScreen } from './lib/prefetch';
import { useLazyPart } from './lib/lazyPart';
import { screenFile } from './lib/idle';
import { joinPath, loginFor, pendingJoin } from './lib/returnTo';
import { MINI_APP_PATH, useMiniApp } from './lib/telegram/miniApp';
import TelegramChrome from './components/telegram/TelegramChrome';
// The reel's and the guide's styles stay in the first stylesheet, in their order ahead of the kit, as
// before the shell became a file of its own. Rules of equal weight decide by order: the guide's stage
// size wins over the reel's (.gd-stage after .mr-stage), and the kit's hover and current-page look of
// «Добавить лекцию» wins over the guide's yellow ring (paper.css after guide.css).
import './components/reel/reel.css';
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
const LectureTalk = lazy(() => import('./pages/LectureTalk'));
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
const ExamReport = lazy(() => import('./pages/ExamReport'));
// The example is opened from phones in a hall: what waits for idle time (the session, the next screens) waits for its
// sheet's file too (lib/idle.ts screenFile).
const TryExample = lazy(() => screenFile(import('./pages/TryExample')));
const Check = lazy(() => import('./pages/Check'));
const JoinGroup = lazy(() => import('./pages/JoinGroup'));
// The exam container (meldy-notes 10_Project/Exam_Container_Spec_2026-10-09.md §7): an exam for a whole session.
const ImportPage = lazy(() => import('./pages/container/ImportPage'));
const ContainerPage = lazy(() => import('./pages/container/ContainerPage'));
const SubjectPage = lazy(() => import('./pages/container/SubjectPage'));
const StudyPage = lazy(() => import('./pages/container/StudyPage'));
const MockPage = lazy(() => import('./pages/container/MockPage'));
const KeysPage = lazy(() => import('./pages/container/KeysPage'));
const QuizListPage = lazy(() => import('./pages/quiz/QuizListPage'));
const QuizSetupPage = lazy(() => import('./pages/quiz/QuizSetupPage'));
const QuizStatsPage = lazy(() => import('./pages/quiz/QuizStatsPage'));
const SettingsPage = lazy(() => import('./pages/container/SettingsPage'));
const JoinContainerPage = lazy(() => import('./pages/container/JoinContainerPage'));
const QuizTakePage = lazy(() => import('./pages/quiz/QuizTakePage'));
// The live game's art on one page (docs/live/CONTRACT.md §10), in development only.
const LiveArtPreview = lazy(() => import('./components/live/art/LiveArtPreview'));
const LiveRoute = lazy(() => import('./pages/live/LiveRoute'));
// The live game's player «Битва с монстром» (docs/live/CONTRACT.md): the site's /play and the Mini App's /tg/play.
const PlayPage = lazy(() => import('./pages/play/PlayPage'));
const TgPlayPage = lazy(() => import('./pages/play/TgPlayPage'));
const NewTestPage = lazy(() => import('./pages/test/NewTestPage'));
const BuildPage = lazy(() => import('./pages/test/BuildPage'));
const StudioPage = lazy(() => import('./pages/test/StudioPage'));
// Meldy as a Telegram Mini App (meldy-notes 10_Project/Telegram_Mini_App_Spec_2026-10-10.md): the bot opens /tg.
const TelegramMiniApp = lazy(() => import('./pages/TelegramMiniApp'));
const MiniAppImportNote = lazy(() => import('./components/telegram/MiniAppImportNote'));

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

export function PrivateRoute({ children }: { children: React.ReactNode }) {
  const { user, loading, requestSession } = useAuth();
  const { pathname, search } = useLocation();
  const mini = useMiniApp();
  // While the session is checked, the shell and the page start loading together (lib/prefetch.ts).
  useEffect(() => {
    requestSession?.();
    preloadSignedInScreen(pathname);
    // Only on entering the signed-in part: inside it, pages load with the shell already in place.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  if (loading) return <RouteLoading />;
  if (user) return <>{children}</>;
  // Inside Telegram the way in is Telegram's own (/tg): the sign-in page's Google refuses Telegram's WebView. While
  // Telegram's script is loading it is not known yet whether this is Telegram.
  if (mini.status === 'loading') return <RouteLoading />;
  if (mini.status === 'on') return <Navigate to={MINI_APP_PATH} replace />;
  // Signed out: the sign-in page, which brings the visitor back to this page afterwards (lib/returnTo).
  return <Navigate to={loginFor(pathname, search)} replace />;
}

/**
 * A group link the visitor went to sign in for (lib/returnTo: meldy_join_pending, a day, this device): when the
 * sign-in comes back to the landing or «Сегодня» instead of /join/<код> (the address lost its way back), the app
 * goes on to the link.
 */
export function PendingJoin() {
  const { user } = useAuth();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  useEffect(() => {
    if (!user || (pathname !== '/' && pathname !== '/dashboard')) return;
    const code = pendingJoin();
    if (code) navigate(joinPath(code), { replace: true });
  }, [user, pathname, navigate]);
  return null;
}

/**
 * «Новый экзамен» has one door, /exams/import (spec decision 21). The editor's old first step, /exams/new, is still
 * linked from /try, «Первые шаги», the empty states, «Прогресс» and ?next= after signing up: it goes on to the import
 * page with its query, hash and state. The editor itself stays at /exams/:id/edit.
 */
export function ExamsNewRedirect() {
  const { search, hash, state } = useLocation();
  return <Navigate to={{ pathname: '/exams/import', search, hash }} state={state} replace />;
}

/**
 * Files are added on the site: inside Telegram (lib/telegram/miniApp) the import page says so and opens the site in
 * the browser (meldy-notes 10_Project/Telegram_Mini_App_Spec_2026-10-10.md §5). Elsewhere it is the import page.
 */
export function ImportRoute() {
  return useMiniApp().status === 'on' ? <MiniAppImportNote /> : <ImportPage />;
}

export default function App() {
  return (
    <BrowserRouter>
      {/* Inside Telegram only: Telegram's theme and «Назад» (outside Telegram it renders and does nothing). */}
      <TelegramChrome />
      <PWAUpdater />
      <ProWindowProvider />
      <IdlePrefetch />
      <PendingJoin />
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
        <Route path="/exams/new" element={<ExamsNewRedirect />} />
        {/* The Mini App's door: Telegram's sign-in, then «Сегодня» and the session (pages/TelegramMiniApp.tsx). */}
        <Route path={MINI_APP_PATH} element={<TelegramMiniApp />} />
        <Route path="/play" element={<PlayPage />} />
        <Route path="/tg/play" element={<TgPlayPage />} />
        <Route path="/" element={
          <PrivateRoute><SignedInShell /></PrivateRoute>
        }>
          <Route path="dashboard" element={<Dashboard />} />
          <Route path="profile" element={<Profile />} />
          <Route path="analyze" element={<Analyze />} />
          <Route path="library" element={<Library />} />
          <Route path="library/:id" element={<MaterialDetail />} />
          <Route path="library/:id/talk" element={<LectureTalk />} />
          <Route path="review" element={<Review />} />
          <Route path="exams" element={<Exams />} />
          {/* The exam container. Static segments outrank :id, so /exams/c/… and /exams/import never reach the oral
              pages below; listed first, these also win the ties of equal rank (/exams/c/draw opens a container). */}
          <Route path="exams/import" element={<ImportRoute />} />
          <Route path="exams/c/:id" element={<ContainerPage />} />
          <Route path="exams/c/:id/s/:subjectId" element={<SubjectPage />} />
          <Route path="exams/c/:id/study" element={<StudyPage />} />
          <Route path="exams/c/:id/mock" element={<MockPage />} />
          <Route path="exams/c/:id/keys" element={<KeysPage />} />
          {/* «Конструктор» (spec 2026-10-18 §47.2): the author's questions as cards; /tests/new names a new test. */}
          <Route path="exams/c/:id/build" element={<BuildPage />} />
          <Route path="exams/c/:id/studio" element={<StudioPage />} />
          <Route path="tests/new" element={<NewTestPage />} />
          {/* «Контрольная» (spec 2026-10-16 part 2): the author's list, settings and live results. */}
          <Route path="exams/c/:id/quizzes" element={<QuizListPage />} />
          <Route path="exams/c/:id/quizzes/new" element={<QuizSetupPage />} />
          <Route path="exams/c/:id/quizzes/:quizId/edit" element={<QuizSetupPage />} />
          <Route path="exams/c/:id/quizzes/:quizId" element={<QuizStatsPage />} />
          <Route path="exams/c/:id/settings" element={<SettingsPage />} />
          <Route path="exams/:id" element={<ExamDetail />} />
          <Route path="exams/:id/edit" element={<ExamEditor />} />
          <Route path="exams/:id/draw" element={<ExamDraw />} />
          <Route path="exams/:id/ticket" element={<ExamTicket />} />
          {/* «Отчёт для преподавателя»: a room to print (pages/ExamReport.tsx); the exam's owner only (row-level security). */}
          <Route path="exams/:id/report" element={<ExamReport />} />
          <Route path="mistakes" element={<MistakeDiary />} />
          <Route path="analytics" element={<Analytics />} />
          <Route path="knowledge-map" element={<KnowledgeMap />} />
        </Route>
        <Route path="/shared/:id" element={<SharedMaterial />} />
        {/* A group link: open without an account (pages/JoinGroup.tsx). */}
        <Route path="/join/:code" element={<JoinGroup />} />
        {/* The exam's group link: the preview opens without an account, sign-in comes back with ?next= (lib/returnTo). */}
        <Route path="/g/:code" element={<JoinContainerPage />} />
        {/* «Контрольная» by its link: the preview opens without an account, sign-in comes back with ?next=. */}
        <Route path="/k/:code" element={<QuizTakePage />} />
        {import.meta.env.DEV && <Route path="/dev/live-art" element={<LiveArtPreview />} />}
        {/* «Битва с монстром», the teacher's screens: /live/new (setup), /live/:id (the game on the projector). */}
        <Route path="/live/*" element={<LiveRoute />} />
        <Route path="/auth/callback" element={<AuthCallback />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      </Suspense>
    </BrowserRouter>
  );
}
