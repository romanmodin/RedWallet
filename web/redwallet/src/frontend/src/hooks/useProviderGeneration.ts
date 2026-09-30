import {
  PROVIDER_EVENT,
  providerGeneration,
} from "@/services/networkGeneration";
import { useEffect, useState } from "react";
export function useProviderGeneration() {
  const [generation, setGeneration] = useState(providerGeneration);
  useEffect(() => {
    const update = () => setGeneration(providerGeneration());
    window.addEventListener(PROVIDER_EVENT, update);
    return () => window.removeEventListener(PROVIDER_EVENT, update);
  }, []);
  return generation;
}
