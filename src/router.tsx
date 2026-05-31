import { 
  createRouter, 
  useRouter,
  createHashHistory, 
  createBrowserHistory 
} from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";

// 🖥️ Safe Tauri Environment Detection
const isTauriDesktop = 
  typeof window !== "undefined" && 
  (Boolean((window as any).__TAURI_INTERNALS__) || 
   Boolean((window as any).__TAURI__) ||
   navigator.userAgent.includes("Tauri"));

// 🛣️ SPA Fail-Safe Routing Choice
// Uses Hash History (/#/app) inside Tauri to prevent "Asset Not Found: index.html" crashes on Windows file protocol.
// Falls back to standard Browser History on regular web setups.
const appHistory = isTauriDesktop ? createHashHistory() : createBrowserHistory();

function DefaultErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  const router = useRouter();

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-destructive/10">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className="h-8 w-8 text-destructive"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z"
            />
          </svg>
        </div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">Something went wrong</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          An unexpected error occurred. Please try again.
        </p>
        {import.meta.env.DEV && error.message && (
          <pre className="mt-4 max-h-40 overflow-auto rounded-md bg-muted p-3 text-left font-mono text-xs text-destructive">
            {error.message}
          </pre>
        )}
        <div className="mt-6 flex items-center justify-center gap-3">
          <button
            type="button"
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Try again
          </button>
          
          {/* 🛠️ Fix: Changed from hard <a href="/"> to router state navigation to prevent asset crashes */}
          <button
            type="button"
            onClick={() => router.navigate({ to: "/" })}
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            Go home
          </button>
        </div>
      </div>
    </div>
  );
}

export const getRouter = () => {
  const router = createRouter({
    routeTree,
    history: appHistory, // Injects safe offline path handling
    context: {
      auth: undefined as any,
      company: undefined as any,
    },
    scrollRestoration: true,
    defaultPreload: "intent",
    defaultPreloadStaleTime: 0,
    defaultErrorComponent: DefaultErrorComponent,
  });

  return router;
};

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof getRouter>;
  }
}
