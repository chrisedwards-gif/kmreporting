"use client";

import { RotaAutosaveAgent } from "@/components/rotas/rota-autosave-agent";
import {
  RotaNoryBuilderV2,
  type RotaNoryBuilderV2Props,
} from "@/components/rotas/rota-nory-builder-v2";
import "./rota-nory-accessibility.css";

export type RotaWeekOverlayProps = RotaNoryBuilderV2Props;

export function RotaWeekOverlay(props: RotaWeekOverlayProps) {
  return (
    <>
      <RotaNoryBuilderV2 {...props} />
      <RotaAutosaveAgent />
    </>
  );
}
