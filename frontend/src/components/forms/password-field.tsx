"use client";

import { EyeIcon, EyeOffIcon } from "lucide-react";
import { useState } from "react";
import type { FieldValues } from "react-hook-form";

import { Button } from "@/components/ui/button";

import { TextField, type TextFieldProps } from "./text-field";

export function PasswordField<T extends FieldValues>(
  props: Omit<TextFieldProps<T>, "type" | "endAdornment">,
) {
  const [visible, setVisible] = useState(false);

  return (
    <TextField
      {...props}
      type={visible ? "text" : "password"}
      endAdornment={
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-9 text-muted-foreground"
          onClick={() => setVisible((current) => !current)}
          aria-label={visible ? "Hide password" : "Show password"}
          aria-pressed={visible}
        >
          {visible ? <EyeOffIcon /> : <EyeIcon />}
        </Button>
      }
    />
  );
}
