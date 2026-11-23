"use client";

import { cloneElement, createContext, isValidElement, useContext, useMemo  } from "react";
import type {ReactNode} from "react";

export type TemplateCopyTranslator = (text: string) => string;
type CopySettings = { translate: TemplateCopyTranslator; render?: <T>(node: T) => T };
const CopyContext = createContext<CopySettings | null>(null);

/** Optional application copy for templates. Without a provider, source copy is unchanged. */
export function TemplateCopyProvider({ translate, render, children }: CopySettings & { children: ReactNode }) {
  const settings = useMemo(() => ({ translate, render }), [translate, render]);
  return <CopyContext.Provider value={settings}>{children}</CopyContext.Provider>;
}

// Only display copy is translated. IDs, form values, data keys, URLs, styles,
// event handlers and application state retain their original values.
const textProps = new Set([
  "children", "title", "subtitle", "description", "label", "textValue", "placeholder", "alt",
  "aria-label", "aria-description", "metricLabel", "emptyMessage", "caption", "heading", "text", "content", "renderValue",
]);
const dataProps = new Set(["items", "options", "tabs", "columns", "series", "ranges", "stats", "data", "nodes", "bar", "line"]);
const dataText = new Set(["label", "title", "description", "subtitle", "header", "role", "joined"]);
const renderProps = new Set(["children", "cell", "header", "formatter", "tickFormatter", "labelFormatter", "renderItem", "node", "link", "tick", "label", "content", "renderValue"]);

/** Translate rendered copy while preserving React nodes, collection IDs and callbacks. */
export function translateTemplateCopy<T>(value: T, translate: TemplateCopyTranslator): T {
  function visit(input: unknown, data = false): unknown {
    if (typeof input === "string") return data ? input : translate(input);
    if (Array.isArray(input)) {
      const result = input.map(item => visit(item, data));
      return result.every((item, index) => item === input[index]) ? input : result;
    }
    if (isValidElement<Record<string, unknown>>(input)) {
      if (typeof input.type === "string" && ["pre", "code", "kbd", "script", "style"].includes(input.type)) return input;
      const updates: Record<string, unknown> = {};
      for (const [key, original] of Object.entries(input.props)) {
        if (textProps.has(key)) updates[key] = renderProps.has(key) && typeof original === "function"
          ? (...args: unknown[]) => visit(original(...args)) : visit(original);
        else if (dataProps.has(key)) updates[key] = visit(original, true);
        else if (renderProps.has(key) && typeof original === "function") updates[key] = (...args: unknown[]) => visit(original(...args));
      }
      return Object.entries(updates).some(([key, result]) => result !== input.props[key]) ? cloneElement(input, updates) : input;
    }
    if (data && input && typeof input === "object" && Object.getPrototypeOf(input) === Object.prototype) {
      const result: Record<string, unknown> = { ...input };
      for (const [key, original] of Object.entries(result)) {
        if (renderProps.has(key) && typeof original === "function") result[key] = (...args: unknown[]) => visit(original(...args));
        else if (dataText.has(key)) result[key] = visit(original);
        else if (original && typeof original === "object") result[key] = visit(original, true);
      }
      return Object.entries(result).some(([key, item]) => item !== (input as Record<string, unknown>)[key]) ? result : input;
    }
    return input;
  }
  return visit(value) as T;
}

/** Apply to a template component's returned JSX; copy updates through React, including portals. */
export function useTemplateCopy() {
  const settings = useContext(CopyContext);
  return useMemo(() => <T,>(node: T): T => settings?.render ? settings.render(node) : settings ? translateTemplateCopy(node, settings.translate) : node, [settings]);
}
