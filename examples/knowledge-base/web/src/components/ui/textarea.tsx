import { forwardRef, type TextareaHTMLAttributes } from "react";
import { cn } from "../../lib/cn.js";

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  function Textarea({ className, ...props }, ref) {
    return (
      <textarea
        ref={ref}
        className={cn(
          "w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm placeholder:text-slate-400 focus:border-slate-500 focus:outline-none",
          className,
        )}
        {...props}
      />
    );
  },
);
