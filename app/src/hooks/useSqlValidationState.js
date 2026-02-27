import { useState } from "react";
import { api } from "../api";

/**
 * Validation popup state.
 * @param {{ setError: (msg: string) => void }} deps
 * @returns {{
 *  validation: any,
 *  validationOpen: boolean,
 *  setValidationOpen: import("react").Dispatch<import("react").SetStateAction<boolean>>,
 *  onValidate: () => Promise<void>
 * }}
 */
export function useSqlValidationState({ setError }) {
  const [validation, setValidation] = useState(null);
  const [validationOpen, setValidationOpen] = useState(false);

  const onValidate = async () => {
    try {
      setValidation(await api.validate());
      setValidationOpen(true);
    } catch (e) {
      setError(e, "validate");
    }
  };

  return {
    validation,
    validationOpen,
    setValidationOpen,
    onValidate
  };
}
