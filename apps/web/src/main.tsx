import { lazy, StrictMode, Suspense, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AnimatePresence, MotionConfig, motion } from "framer-motion";
import "./index.css";
import { useConfig, useProgress } from "./lib/queries";
import { applyPrefs, usePrefs } from "./lib/store";
import { setLocale } from "./lib/strings";
import { stop as stopVoice } from "./lib/voice";
import { Spinner, Toasts } from "./components/Layout";
import { FloatLayer } from "./components/Juice";
import { AudioDock } from "./components/AudioDock";
import { SettingsPanel } from "./components/Settings";
import { Title } from "./screens/Title";
import { Register } from "./screens/Register";
import { HowToPlay } from "./screens/HowToPlay";
import { Rules } from "./screens/Rules";
import { Journey } from "./screens/Journey";
import { PreRound } from "./screens/PreRound";
import { Round } from "./screens/Round";
import { Report } from "./screens/Report";
import { Review } from "./screens/Review";
import { Total } from "./screens/Total";
import { Leaderboard } from "./screens/Leaderboard";
import { Profile } from "./screens/Profile";

// The console is route-split so players never download it (§4).
const Manager = lazy(() => import("./manager/Manager"));

const qc = new QueryClient({ defaultOptions: { queries: { refetchOnWindowFocus: false, retry: 1 } } });
setLocale("en");
applyPrefs(usePrefs.getState());

function Player({ children }: { children: React.ReactNode }) {
  const { data, isLoading, isError, refetch } = useProgress();
  if (isLoading) return <Spinner />;
  // only a confirmed signed-out answer sends the player to sign-in; a failed check offers a retry instead
  if (isError && !data) return (
    <div data-testid="session-check-failed" className="min-h-screen grid place-items-center p-6 text-center">
      <div><p className="text-navy-700 font-semibold">Connection problem. You are still signed in.</p>
        <button data-testid="session-retry" className="btn-primary mt-4" onClick={() => refetch()}>Try again</button></div>
    </div>
  );
  if (!data?.registered) return <Navigate to="/register" replace />;
  return <>{children}</>;
}

/** Optional BHASHINI website-translation plugin (config.ui.translationPlugin). The workbench is marked translate="no". */
function TranslationPlugin() {
  const { data: cfg } = useConfig();
  useEffect(() => {
    if (cfg?.ui?.locale) setLocale(cfg.ui.locale);
    const p = cfg?.ui?.translationPlugin;
    if (!p?.enabled || !p.scriptUrl || document.querySelector("script[data-bhashini-plugin]")) return;
    const s = document.createElement("script");
    s.src = p.scriptUrl;
    s.async = true;
    s.dataset.bhashiniPlugin = "1";
    document.body.appendChild(s);
  }, [cfg]);
  return null;
}

/** Scenes slide and dissolve instead of cutting (game feel); Sahayika stops when the scene changes. No CSS filter here: a leftover filter becomes the containing block of every `position: fixed` element (status bar, chat, overlays). */
function Scenes() {
  const location = useLocation();
  useEffect(() => { stopVoice(); }, [location.pathname]);
  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div key={location.pathname.startsWith("/manager") ? "/manager" : location.pathname}
        initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -12 }}
        transition={{ duration: 0.32, ease: [0.2, 0.8, 0.2, 1] }} className="relative z-[1] min-h-screen">
        <Routes location={location}>
          <Route path="/" element={<Title />} />
          <Route path="/register" element={<Register />} />
          <Route path="/how-to-play" element={<Player><HowToPlay /></Player>} />
          <Route path="/rules" element={<Player><Rules /></Player>} />
          <Route path="/journey" element={<Player><Journey /></Player>} />
          <Route path="/play/:key" element={<Player><PreRound /></Player>} />
          <Route path="/round/:id" element={<Player><Round /></Player>} />
          <Route path="/report/:id" element={<Player><Report /></Player>} />
          <Route path="/review/:id" element={<Player><Review /></Player>} />
          <Route path="/total" element={<Player><Total /></Player>} />
          <Route path="/leaderboard" element={<Player><Leaderboard /></Player>} />
          <Route path="/profile" element={<Player><Profile /></Player>} />
          <Route path="/manager/*" element={<Suspense fallback={<Spinner />}><Manager /></Suspense>} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </motion.div>
    </AnimatePresence>
  );
}

function App() {
  const reduce = usePrefs((s) => s.reduceMotion);
  return (
    <MotionConfig reducedMotion={reduce ? "always" : "user"}>
      <BrowserRouter>
        <TranslationPlugin />
        <Scenes />
        <Toasts />
        <FloatLayer />
        <AudioDock />
        <SettingsPanel />
      </BrowserRouter>
    </MotionConfig>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={qc}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
);
