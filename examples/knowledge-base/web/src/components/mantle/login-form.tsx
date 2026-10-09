import { useState, type FormEvent } from "react";
import { FieldError, Form, TextField } from "react-aria-components";
import type { AuthResult } from "@mantlejs/client";
import { cn } from "cn";
import { toFormErrors, type FormErrors } from "@/lib/mantle-errors";
import { useAuth } from "@/components/mantle/auth-provider";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export interface LoginFormProps {
  /** Called with the auth result after a successful login. */
  onSuccess?: (result: AuthResult) => void;
  /** Submit button text. @default "Log in" */
  submitLabel?: string;
  className?: string;
}

/**
 * Email/password login against `@mantlejs/auth-local`. Built on React Aria `Form` + `TextField`:
 * required/email validation is native and announced to assistive tech, and server-side validation
 * errors land on the matching field via `validationErrors`; anything else shows in a form-level alert.
 */
export function LoginForm({ onSuccess, submitLabel = "Log in", className }: LoginFormProps) {
  const { login, oauthError } = useAuth();
  const [errors, setErrors] = useState<FormErrors>({ fields: {} });
  const [pending, setPending] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setErrors({ fields: {} });
    setPending(true);
    try {
      const result = await login({ email: String(data.get("email")), password: String(data.get("password")) });
      onSuccess?.(result);
    } catch (error) {
      setErrors(toFormErrors(error));
    } finally {
      setPending(false);
    }
  }

  const formError = errors.form ?? oauthError;
  return (
    <Form
      onSubmit={handleSubmit}
      validationErrors={errors.fields}
      className={cn("flex flex-col gap-4", className)}
      aria-label="Log in"
    >
      {formError && (
        <Alert variant="destructive">
          <AlertDescription>{formError}</AlertDescription>
        </Alert>
      )}
      <TextField name="email" type="email" autoComplete="email" isRequired className="flex flex-col gap-2">
        <Label>Email</Label>
        <Input />
        <FieldError className="text-sm text-destructive" />
      </TextField>
      <TextField name="password" type="password" autoComplete="current-password" isRequired className="flex flex-col gap-2">
        <Label>Password</Label>
        <Input />
        <FieldError className="text-sm text-destructive" />
      </TextField>
      <Button type="submit" isPending={pending}>
        {submitLabel}
      </Button>
    </Form>
  );
}
