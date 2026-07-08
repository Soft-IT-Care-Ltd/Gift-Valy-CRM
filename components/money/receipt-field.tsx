"use client";

import { useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

// Receipt upload for the expense form — picks an image, POSTs it to /api/uploads,
// and hands the stored URL back to the form state (mirrors catalog PhotoField).
export function ReceiptField({
  value,
  onChange,
}: {
  value: string;
  onChange: (url: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // re-picking the same file fires change again
    if (!file) return;
    setUploading(true);
    const form = new FormData();
    form.append("file", file);
    const res = await fetch("/api/uploads", { method: "POST", body: form });
    setUploading(false);
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      toast.error(data?.error ?? "Upload failed");
      return;
    }
    const data = await res.json();
    onChange(data.url);
  }

  return (
    <div className="flex items-center gap-2">
      {value && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={value}
          alt="Receipt preview"
          className="h-10 w-10 shrink-0 rounded-md border object-cover"
        />
      )}
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => inputRef.current?.click()}
        disabled={uploading}
      >
        {uploading ? "Uploading…" : value ? "Replace" : "Upload receipt"}
      </Button>
      {value && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => onChange("")}
        >
          Remove
        </Button>
      )}
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={handleFile}
      />
    </div>
  );
}
