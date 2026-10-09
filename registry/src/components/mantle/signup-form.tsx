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

export interface SignupFormProps {
  /** Called with the auth result once the account is created and logged in. */
  onSuccess?: (result: AuthResult) => void;
  /** Show a "Name" field (sent as `name`). @default true */
  withName?: boolean;
  /** Client-side minimum password length — keep it in line with your server-side schema. @default 8 */
  minPasswordLength?: number;
  /** Submit button text. @default "Create account" */
  submitLabel?: string;
  className?: string;
}

/**
 * Account creation via the users service (`AuthProvider`'s `usersService`), then local login with the
 * same credentials. A duplicate email (`Conflict`) or a failed schema check (`Unprocessable`, mapped to
 * the offending field) is shown inline; the form never loses what the user typed.
 */
export function SignupForm({
  onSuccess,
  withName = true,
  minPasswordLength = 8,
  submitLabel = "Create account",
  className,
}: SignupFormProps) {
  const { signup } = useAuth();
  const [errors, setErrors] = useState<FormErrors>({ fields: {} });
  const [pending, setPending] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setErrors({ fields: {} });
    setPending(true);
    try {
      const result = await signup({
        email: String(data.get("email")),
        password: String(data.get("password")),
        ...(withName ? { name: String(data.get("name")) } : {}),
      });
      onSuccess?.(result);
    } catch (error) {
      setErrors(toFormErrors(error));
    } finally {
      setPending(false);
    }
  }

  return (
    <Form
      onSubmit={handleSubmit}
      validationErrors={errors.fields}
      className={cn("flex flex-col gap-4", className)}
      aria-label="Create account"
    >
      {errors.form && (
        <Alert variant="destructive">
          <AlertDescription>{errors.form}</AlertDescription>
        </Alert>
      )}
      {withName && (
        <TextField name="name" autoComplete="name" isRequired className="flex flex-col gap-2">
          <Label>Name</Label>
          <Input />
          <FieldError className="text-sm text-destructive" />
        </TextField>
      )}
      <TextField name="email" type="email" autoComplete="email" isRequired className="flex flex-col gap-2">
        <Label>Email</Label>
        <Input />
        <FieldError className="text-sm text-destructive" />
      </TextField>
      <TextField
        name="password"
        type="password"
        autoComplete="new-password"
        isRequired
        validate={(value) =>
          value.length > 0 && value.length < minPasswordLength ? `Use at least ${minPasswordLength} characters.` : null
        }
        className="flex flex-col gap-2"
      >
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
