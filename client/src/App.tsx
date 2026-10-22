import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { lazy, Suspense } from "react";
import { Route, Switch } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import Home from "./pages/Home";

// Loaded only when someone opens /acoustic, so the sound engine never slows the dashboard.
const AcousticPage = lazy(() => import("@/features/acoustic/AcousticPage"));

function Router() {
  return <Suspense fallback={null}><Switch><Route path="/" component={Home}/><Route path="/acoustic" component={AcousticPage}/><Route path="/404" component={NotFound}/><Route component={NotFound}/></Switch></Suspense>;
}

export default function App() {
  return <ErrorBoundary><ThemeProvider defaultTheme="dark"><TooltipProvider><Toaster theme="dark"/><Router/></TooltipProvider></ThemeProvider></ErrorBoundary>;
}
