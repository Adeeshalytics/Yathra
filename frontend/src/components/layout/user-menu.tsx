"use client";

import { LayoutDashboardIcon, LogOutIcon } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAuth } from "@/hooks/use-auth";
import type { User } from "@/lib/api/types";
import { ROLE_HOME, ROLE_LABEL } from "@/lib/auth/roles";
import { firstName, initials } from "@/lib/format";

export function UserMenu({ user }: { user: User }) {
  const { logout } = useAuth();
  const [confirmOpen, setConfirmOpen] = useState(false);

  return (
    <>
      {/* Non-modal so the confirm dialog can take focus cleanly after the menu closes. */}
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" className="h-10 gap-2 rounded-full pr-3 pl-1">
            <Avatar>
              <AvatarFallback className="bg-primary text-xs font-semibold text-primary-foreground">
                {initials(user.name)}
              </AvatarFallback>
            </Avatar>
            <span className="hidden max-w-32 truncate text-sm font-medium sm:inline">
              {firstName(user.name) || "Account"}
            </span>
            <span className="sr-only">Open account menu</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64">
          <DropdownMenuLabel className="font-normal">
            <div className="flex flex-col gap-0.5">
              <span className="truncate text-sm font-semibold text-foreground">
                {user.name || user.phone}
              </span>
              <span className="truncate text-xs text-muted-foreground">
                {user.email || user.phone}
              </span>
              <span className="mt-1 text-xs font-medium text-primary">{ROLE_LABEL[user.role]}</span>
            </div>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem asChild>
            <Link href={ROLE_HOME[user.role]}>
              <LayoutDashboardIcon />
              {user.role === "customer" ? "My account" : "Dashboard"}
            </Link>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onSelect={() => setConfirmOpen(true)}>
            <LogOutIcon />
            Sign out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Sign out?"
        description="You’ll need to sign in again to manage your bookings."
        confirmLabel="Sign out"
        destructive
        onConfirm={async () => {
          await logout();
          toast.success("You’ve been signed out.");
        }}
      />
    </>
  );
}
