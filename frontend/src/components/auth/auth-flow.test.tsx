import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/lib/api/errors";
import type { User } from "@/lib/api/types";

const auth = vi.hoisted(() => ({
  login: vi.fn(),
  register: vi.fn(),
  logout: vi.fn(),
  updateProfile: vi.fn(),
  changePassword: vi.fn(),
  me: vi.fn(),
}));
const router = vi.hoisted(() => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }));
const authState = vi.hoisted(() => ({
  current: { status: "unauthenticated", user: null, reason: null } as {
    status: string;
    user: User | null;
    reason: string | null;
  },
}));

vi.mock("@/lib/api/endpoints", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/endpoints")>();
  return { ...actual, authApi: { ...actual.authApi, ...auth } };
});
vi.mock("next/navigation", () => ({
  useRouter: () => router,
  usePathname: () => "/admin/bookings",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/hooks/use-auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/hooks/use-auth")>();
  return {
    ...actual,
    useAuth: () => ({
      ...authState.current,
      isAuthenticated: authState.current.status === "authenticated",
      login: auth.login,
      register: auth.register,
      logout: auth.logout,
      updateProfile: auth.updateProfile,
      changePassword: auth.changePassword,
    }),
  };
});

import { LoginForm } from "./login-form";
import { RequireAuth } from "./require-auth";

const CUSTOMER: User = {
  id: "user-1",
  name: "Kasuni Fernando",
  email: "kasuni@example.com",
  phone: "+94771234567",
  role: "customer",
  is_active: true,
  created_at: "2030-09-01T09:00:00+05:30",
  updated_at: "2030-09-01T09:00:00+05:30",
};

const ADMIN: User = { ...CUSTOMER, id: "user-2", role: "admin", name: "Admin User" };

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe("Signing in", () => {
  beforeEach(() => {
    Object.values(auth).forEach((fn) => fn.mockReset());
    Object.values(router).forEach((fn) => fn.mockReset());
    authState.current = { status: "unauthenticated", user: null, reason: null };
  });

  it("validates the form before calling the API", async () => {
    const user = userEvent.setup();
    render(<LoginForm />, { wrapper });

    await user.click(screen.getByRole("button", { name: "Sign in" }));

    expect(await screen.findByText("Enter a valid email address.")).toBeInTheDocument();
    expect(screen.getByText("Enter your password.")).toBeInTheDocument();
    expect(auth.login).not.toHaveBeenCalled();
  });

  it("refuses an email that is not an email", async () => {
    const user = userEvent.setup();
    render(<LoginForm />, { wrapper });

    await user.type(screen.getByLabelText("Email"), "not-an-email");
    await user.type(screen.getByLabelText("Password"), "Str0ng-Pass!");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    expect(await screen.findByText(/valid email/i)).toBeInTheDocument();
    expect(auth.login).not.toHaveBeenCalled();
  });

  it("signs in and hands the session to the store", async () => {
    const user = userEvent.setup();
    auth.login.mockResolvedValue(CUSTOMER);
    render(<LoginForm />, { wrapper });

    await user.type(screen.getByLabelText("Email"), "kasuni@example.com");
    await user.type(screen.getByLabelText("Password"), "Str0ng-Pass!");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    expect(auth.login).toHaveBeenCalledWith({
      email: "kasuni@example.com",
      password: "Str0ng-Pass!",
    });
  });

  it("shows the server's message when the credentials are wrong", async () => {
    const user = userEvent.setup();
    auth.login.mockRejectedValue(
      new ApiError({
        status: 401,
        code: "authentication_failed",
        message: "Email or password is incorrect.",
      }),
    );
    render(<LoginForm />, { wrapper });

    await user.type(screen.getByLabelText("Email"), "kasuni@example.com");
    await user.type(screen.getByLabelText("Password"), "wrong-password");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    expect(await screen.findByText("Email or password is incorrect.")).toBeInTheDocument();
  });

  it("explains a network failure instead of failing silently", async () => {
    const user = userEvent.setup();
    auth.login.mockRejectedValue(ApiError.network());
    render(<LoginForm />, { wrapper });

    await user.type(screen.getByLabelText("Email"), "kasuni@example.com");
    await user.type(screen.getByLabelText("Password"), "Str0ng-Pass!");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    expect(await screen.findByText(/couldn’t reach the server/i)).toBeInTheDocument();
  });

  it("sends a signed-in visitor away from the sign-in page", async () => {
    authState.current = { status: "authenticated", user: ADMIN, reason: null };
    render(<LoginForm />, { wrapper });

    await vi.waitFor(() => expect(router.replace).toHaveBeenCalledWith("/admin"));
  });
});

describe("Guarding a signed-in area", () => {
  beforeEach(() => {
    Object.values(router).forEach((fn) => fn.mockReset());
  });

  it("waits while the session is being restored", () => {
    authState.current = { status: "loading", user: null, reason: null };

    render(
      <RequireAuth roles={["admin"]}>
        <p>Secret</p>
      </RequireAuth>,
      { wrapper },
    );

    expect(screen.getByText("Checking your session…")).toBeInTheDocument();
    expect(screen.queryByText("Secret")).not.toBeInTheDocument();
    expect(router.replace).not.toHaveBeenCalled();
  });

  it("sends an expired session to sign in, remembering where it was going", async () => {
    authState.current = { status: "unauthenticated", user: null, reason: "expired" };

    render(
      <RequireAuth roles={["admin"]}>
        <p>Secret</p>
      </RequireAuth>,
      { wrapper },
    );

    await vi.waitFor(() =>
      expect(router.replace).toHaveBeenCalledWith("/login?next=%2Fadmin%2Fbookings"),
    );
  });

  it("sends a deliberate sign-out home instead", async () => {
    authState.current = { status: "unauthenticated", user: null, reason: "logout" };

    render(
      <RequireAuth roles={["admin"]}>
        <p>Secret</p>
      </RequireAuth>,
      { wrapper },
    );

    await vi.waitFor(() => expect(router.replace).toHaveBeenCalledWith("/"));
  });

  it("turns away a signed-in user with the wrong role", () => {
    authState.current = { status: "authenticated", user: CUSTOMER, reason: null };

    render(
      <RequireAuth roles={["admin"]}>
        <p>Secret</p>
      </RequireAuth>,
      { wrapper },
    );

    expect(screen.getByText("You don’t have access to this area")).toBeInTheDocument();
    expect(screen.queryByText("Secret")).not.toBeInTheDocument();
    const link = screen.getByRole("link", { name: "Go to my dashboard" });
    expect(link).toHaveAttribute("href", "/account");
  });

  it("lets the right role through", () => {
    authState.current = { status: "authenticated", user: ADMIN, reason: null };

    render(
      <RequireAuth roles={["admin"]}>
        <p>Secret</p>
      </RequireAuth>,
      { wrapper },
    );

    expect(screen.getByText("Secret")).toBeInTheDocument();
  });

  it("accepts any of several roles", () => {
    authState.current = { status: "authenticated", user: CUSTOMER, reason: null };

    render(
      <RequireAuth roles={["customer", "admin"]}>
        <p>Shared</p>
      </RequireAuth>,
      { wrapper },
    );

    expect(within(document.body).getByText("Shared")).toBeInTheDocument();
  });
});
