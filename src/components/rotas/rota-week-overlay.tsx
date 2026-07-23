"use client";

import { useEffect } from "react";
import {
  RotaNoryBuilder,
  type RotaNoryBuilderProps,
} from "@/components/rotas/rota-nory-builder";
import "./rota-nory-accessibility.css";

export type RotaWeekOverlayProps = RotaNoryBuilderProps;

export function RotaWeekOverlay(props: RotaWeekOverlayProps) {
  useEffect(() => {
    document.querySelectorAll<HTMLElement>(".nory-rota__role-row[role='row']")
      .forEach((element) => element.setAttribute("role", "presentation"));
  }, []);

  return <RotaNoryBuilder {...props} />;
}
