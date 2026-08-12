import { forwardRef, type HTMLAttributes, type ReactNode, Suspense, lazy } from "react";

type MotionTarget = Record<string, unknown>;

export interface MotionDivProps extends HTMLAttributes<HTMLDivElement> {
  children?: ReactNode;
  initial?: boolean | string | MotionTarget;
  animate?: string | MotionTarget;
  exit?: string | MotionTarget;
  whileHover?: string | MotionTarget;
  whileTap?: string | MotionTarget;
  whileInView?: string | MotionTarget;
  variants?: Record<string, MotionTarget>;
  transition?: Record<string, unknown>;
  viewport?: { once?: boolean; margin?: string; amount?: number | "some" | "all" };
}

// Lazy load framer-motion to reduce initial bundle size
const LazyMotionDiv = lazy(async () => {
  const { motion } = await import("framer-motion");
  const MotionBase = motion.div as unknown as React.ForwardRefExoticComponent<
    MotionDivProps & React.RefAttributes<HTMLDivElement>
  >;

  const Component = forwardRef<HTMLDivElement, MotionDivProps>(
    (props, ref) => <MotionBase ref={ref} {...props} />,
  );
  Component.displayName = "MotionDiv";
  return { default: Component };
});

// Fallback: render as div if motion library fails to load
const FallbackDiv = forwardRef<HTMLDivElement, MotionDivProps>(
  (props, ref) => {
    const { children, initial, animate, exit, whileHover, whileTap, whileInView, variants, transition, viewport, ...rest } = props;
    return <div ref={ref} {...rest}>{children}</div>;
  },
);
FallbackDiv.displayName = "FallbackDiv";

export const MotionDiv = forwardRef<HTMLDivElement, MotionDivProps>(
  (props, ref) => (
    <Suspense fallback={<FallbackDiv ref={ref} {...props} />}>
      <LazyMotionDiv ref={ref} {...props} />
    </Suspense>
  ),
);
MotionDiv.displayName = "MotionDiv";
