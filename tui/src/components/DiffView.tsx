import React, { useState, useMemo } from "react";
import { Box, Text, useInput } from "ink";
import type { DiffTarget } from "../lib/types.js";
import { DiffFileList } from "./DiffFileList.js";
import { DiffDetail } from "./DiffDetail.js";

interface DiffViewProps {
  target: DiffTarget;
  onClose: () => void;
  onPullBack?: () => void;
}

type Step = "files" | "detail";

export function DiffView({ target, onClose, onPullBack }: DiffViewProps) {
  // Skip file list if only one file - go directly to detail
  const singleFile = target.files.length === 1;
  const initialStep: Step = singleFile ? "detail" : "files";
  const initialFileIndex = singleFile ? 0 : null;

  const [step, setStep] = useState<Step>(initialStep);
  const [selectedFileIndex, setSelectedFileIndex] = useState<number | null>(initialFileIndex);

  const selectedFile = useMemo(() => {
    if (selectedFileIndex === null) return null;
    return target.files[selectedFileIndex] || null;
  }, [target.files, selectedFileIndex]);

  useInput((input, key) => {
    if (key.escape) {
      if (step === "detail") {
        // If we started at detail (single file), go back to caller
        if (singleFile) {
          onClose();
        } else {
          setStep("files");
          setSelectedFileIndex(null);
        }
      } else {
        onClose();
      }
    }
    if (input === "p" && onPullBack) {
      onPullBack();
    }
  });

  if (step === "detail" && selectedFile) {
    return (
      <DiffDetail
        file={selectedFile}
        title={target.title}
        instanceName={target.instance.instanceName}
        onBack={() => {
          if (singleFile) {
            onClose();
          } else {
            setStep("files");
            setSelectedFileIndex(null);
          }
        }}
        onPullBack={onPullBack}
      />
    );
  }

  // Step: files
  return (
    <DiffFileList
      title={target.title}
      instanceName={target.instance.instanceName}
      files={target.files}
      onSelect={(index) => {
        setSelectedFileIndex(index);
        setStep("detail");
      }}
      onClose={onClose}
      onPullBack={onPullBack}
    />
  );
}
