"use client";

import { Eye, EyeOff } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type PasswordFieldProps = {
  autoComplete: string;
  error?: string;
  id: string;
  label: string;
  onChange: (value: string) => void;
  placeholder: string;
  value: string;
};

export function PasswordField({
  autoComplete,
  error,
  id,
  label,
  onChange,
  placeholder,
  value,
}: PasswordFieldProps) {
  const [isVisible, setIsVisible] = useState(false);

  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <div className="relative">
        <Input
          autoComplete={autoComplete}
          className="pr-11"
          id={id}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          type={isVisible ? "text" : "password"}
          value={value}
        />
        <Button
          aria-label={isVisible ? "Ocultar senha" : "Mostrar senha"}
          className="absolute right-1 top-1/2 size-9 -translate-y-1/2"
          onClick={() => setIsVisible((current) => !current)}
          size="icon"
          type="button"
          variant="ghost"
        >
          {isVisible ? <EyeOff /> : <Eye />}
        </Button>
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
