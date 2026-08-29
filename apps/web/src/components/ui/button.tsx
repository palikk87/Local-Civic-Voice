import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary/90",
        destructive: "bg-destructive text-destructive-foreground hover:bg-destructive/90",
        outline: "border border-input bg-background hover:bg-accent hover:text-accent-foreground",
        secondary: "bg-secondary text-secondary-foreground hover:bg-secondary/80",
        ghost: "hover:bg-accent hover:text-accent-foreground",
        link: "text-primary underline-offset-4 hover:underline",
        /* A physical token: a hard edge underneath, and pressing it moves the
           face down onto the base. Used for Aye and Nay.

           Aye is the LIGHT chip and Nay the DARK one, so the pair survives
           red-green colour blindness. Nay carries a border because a deep
           crimson on deep felt is only 1.6:1 against the card — the edge is
           what makes it a button rather than a shape. */
        aye: "chip-press border-2 border-support bg-support font-bold tracking-widest text-support-foreground shadow-[0_4px_0_hsl(150_62%_18%)] hover:bg-support/90 active:shadow-[0_1px_0_hsl(150_62%_18%)]",
        nay: "chip-press border-2 border-oppose/80 bg-oppose font-bold tracking-widest text-oppose-foreground shadow-[0_4px_0_hsl(344_79%_18%)] hover:bg-oppose/90 active:shadow-[0_1px_0_hsl(344_79%_18%)]",
      },
      size: {
        default: "h-10 px-4 py-2",
        sm: "h-9 rounded-md px-3",
        lg: "h-11 rounded-md px-8",
        icon: "h-10 w-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />;
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };
