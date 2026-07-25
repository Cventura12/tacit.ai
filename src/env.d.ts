// Minimal stubs for motion until npm install resolves the full package.
// The runtime files exist in node_modules; only the type declarations are
// gated behind OneDrive on-demand sync. Remove once npm install completes.

type MotionProps = {
  initial?: Record<string, unknown>;
  animate?: Record<string, unknown> | string;
  exit?: Record<string, unknown>;
  transition?: Record<string, unknown>;
  variants?: Record<string, unknown>;
  layout?: boolean | string;
  whileHover?: Record<string, unknown>;
  whileTap?: Record<string, unknown>;
  whileInView?: Record<string, unknown>;
};

type MotionEl<T extends keyof JSX.IntrinsicElements> = import("react").ForwardRefExoticComponent<
  JSX.IntrinsicElements[T] & MotionProps & { ref?: import("react").Ref<HTMLElement> }
>;

type MotionDOMProxy = {
  [K in keyof JSX.IntrinsicElements]: MotionEl<K>;
};

declare module "framer-motion" {
  export const motion: MotionDOMProxy;
  export const AnimatePresence: import("react").FC<{
    children?: import("react").ReactNode;
    mode?: "wait" | "sync" | "popLayout";
    initial?: boolean;
    onExitComplete?: () => void;
  }>;
}

declare module "motion/react" {
  export * from "framer-motion";
}
