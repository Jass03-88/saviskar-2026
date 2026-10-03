"use client";

import { useState, useRef } from "react";
import { UploadCloud, CheckCircle2, AlertCircle, X, Image as ImageIcon, Loader2 } from "lucide-react";

interface ImageUploaderProps {
  onUploadSuccess: (path: string) => void;
  onUploadError?: (error: string) => void;
  onRemove?: () => void;
  existingPath?: string;
  label?: string;
  required?: boolean;
}

export function ImageUploader({
  onUploadSuccess,
  onUploadError,
  onRemove,
  existingPath,
  label = "Upload ID Card",
  required = true,
}: ImageUploaderProps) {
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploadedPath, setUploadedPath] = useState<string | null>(existingPath || null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setError(null);

    // Validate size (< 2MB)
    if (file.size > 2 * 1024 * 1024) {
      const msg = "File is too large. Maximum size is 2MB.";
      setError(msg);
      if (onUploadError) onUploadError(msg);
      return;
    }

    if (!file.type.startsWith("image/")) {
      const msg = "Only image files are allowed.";
      setError(msg);
      if (onUploadError) onUploadError(msg);
      return;
    }

    try {
      setIsUploading(true);

      const formData = new FormData();
      formData.append("file", file);

      const res = await fetch("/api/upload-id", {
        method: "POST",
        body: formData,
      });

      const data = await res.json();

      if (!res.ok || !data.success) {
        throw new Error(data.error || "Failed to upload image");
      }

      setUploadedPath(data.path);
      onUploadSuccess(data.path);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "An unexpected error occurred.";
      setError(msg);
      if (onUploadError) onUploadError(msg);
    } finally {
      setIsUploading(false);
      // Reset input so the same file can be selected again if it failed
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  };

  const handleRemove = () => {
    setUploadedPath(null);
    setError(null);
    if (onRemove) onRemove();
  };

  return (
    <div className="flex flex-col gap-2">
      <label className="text-sm font-medium text-white/90">
        {label} {required && <span className="text-rose-400">*</span>}
      </label>
      
      {uploadedPath ? (
        <div className="flex items-center justify-between p-3 rounded-lg border border-emerald-500/30 bg-emerald-500/10 backdrop-blur-sm relative overflow-hidden group transition-all">
          <div className="flex items-center gap-3 relative z-10">
            <div className="h-8 w-8 rounded-full bg-emerald-500/20 flex items-center justify-center text-emerald-400 shrink-0">
              <CheckCircle2 className="h-5 w-5" />
            </div>
            <div className="text-sm text-emerald-200">
              Image uploaded successfully
            </div>
          </div>
          <button
            type="button"
            onClick={handleRemove}
            className="text-white/50 hover:text-white p-1 rounded-full hover:bg-white/10 transition-colors z-10"
          >
            <X className="h-4 w-4" />
          </button>
          
          <div className="absolute inset-0 bg-gradient-to-r from-emerald-500/0 via-emerald-500/5 to-emerald-500/0 translate-x-[-100%] group-hover:animate-[shimmer_2s_infinite]" />
        </div>
      ) : (
        <div 
          onClick={() => !isUploading && fileInputRef.current?.click()}
          className={`
            relative flex flex-col items-center justify-center p-6 border-2 border-dashed rounded-xl cursor-pointer transition-all duration-300
            ${error ? 'border-rose-500/50 bg-rose-500/5' : 'border-white/10 bg-white/5 hover:border-white/20 hover:bg-white/10'}
            ${isUploading ? 'opacity-70 pointer-events-none' : ''}
          `}
        >
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleFileChange}
            accept="image/*"
            className="hidden"
          />
          
          {isUploading ? (
            <div className="flex flex-col items-center text-primary">
              <Loader2 className="h-8 w-8 animate-spin mb-2" />
              <p className="text-sm font-medium">Uploading...</p>
            </div>
          ) : (
            <>
              <div className="h-10 w-10 rounded-full bg-white/5 flex items-center justify-center text-white/60 mb-3">
                <UploadCloud className="h-5 w-5" />
              </div>
              <p className="text-sm text-white/80 font-medium mb-1">
                Click to upload image
              </p>
              <p className="text-xs text-white/40 text-center max-w-[200px]">
                JPEG, PNG or WEBP (max. 2MB)
              </p>
            </>
          )}
        </div>
      )}

      {error && (
        <div className="flex items-center gap-1.5 text-xs text-rose-400 mt-1">
          <AlertCircle className="h-3.5 w-3.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}
    </div>
  );
}
