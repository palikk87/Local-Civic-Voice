import type { Config } from "tailwindcss";
import tailwindcssAnimate from "tailwindcss-animate";

export default {
  darkMode: ["class"],
  content: [
    "./pages/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./app/**/*.{ts,tsx}",
    "./src/**/*.{ts,tsx}",
  ],
  prefix: "",
  theme: {
    container: {
      center: true,
      padding: "2rem",
      screens: {
        "2xl": "1400px",
      },
    },
    extend: {
      colors: {
        /**
         * SLATE IS GREEN NOW, AND THAT IS THE WHOLE THEME CHANGE.
         *
         * About a thousand class names in this app are written as bg-slate-800,
         * text-slate-400, border-slate-700 and so on. Rewriting every one of
         * them to a new colour name would be a thousand chances to miss one and
         * leave a single grey card sitting in a green room.
         *
         * So the scale itself moves instead. Same lightness ladder as
         * Tailwind's slate — a 400 is still a muted label, an 800 is still a
         * card, a 900 is still the ground — with the hue turned to deep felt
         * green. Every existing class keeps the role it was written for and
         * arrives in the new palette without being touched.
         *
         * Contrast was measured, not eyeballed. The six pairs this app actually
         * uses all clear WCAG AA on the new scale; the tightest is
         * text-slate-500 on bg-slate-900 at 4.64:1.
         *
         * Amber is left exactly as Tailwind ships it. It was already the gold.
         */
        slate: {
          50: "#F5F0E6",
          100: "#E7EFE9",
          200: "#D0E0D6",
          300: "#B4C7BC",
          400: "#8FA79A",
          500: "#6E8A7C",
          600: "#4C6659",
          700: "#2C4A3C",
          800: "#17362A",
          900: "#0C1D18",
          950: "#071410",
        },
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
          /* The same gold with the light on it. */
          lit: "hsl(var(--accent-lit))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        support: {
          DEFAULT: "hsl(var(--support))",
          foreground: "hsl(var(--support-foreground))",
        },
        oppose: {
          DEFAULT: "hsl(var(--oppose))",
          foreground: "hsl(var(--oppose-foreground))",
        },
        legislative: "hsl(var(--legislative))",
        executive: "hsl(var(--executive))",
        judicial: "hsl(var(--judicial))",
        sidebar: {
          DEFAULT: "hsl(var(--sidebar-background))",
          foreground: "hsl(var(--sidebar-foreground))",
          primary: "hsl(var(--sidebar-primary))",
          "primary-foreground": "hsl(var(--sidebar-primary-foreground))",
          accent: "hsl(var(--sidebar-accent))",
          "accent-foreground": "hsl(var(--sidebar-accent-foreground))",
          border: "hsl(var(--sidebar-border))",
          ring: "hsl(var(--sidebar-ring))",
        },
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      fontFamily: {
        display: ["Fraunces", "Georgia", "serif"],
        sans: ["Public Sans", "system-ui", "sans-serif"],
        mono: ["IBM Plex Mono", "ui-monospace", "monospace"],
      },
      keyframes: {
        "accordion-down": {
          from: {
            height: "0",
          },
          to: {
            height: "var(--radix-accordion-content-height)",
          },
        },
        "accordion-up": {
          from: {
            height: "var(--radix-accordion-content-height)",
          },
          to: {
            height: "0",
          },
        },
        "shimmer-sweep": {
          "0%": {
            backgroundPosition: "-200% center",
          },
          "50%": {
            backgroundPosition: "200% center",
          },
          "100%": {
            backgroundPosition: "-200% center",
          },
        },
        "glow-pulse": {
          "0%, 100%": {
            opacity: "0.4",
          },
          "50%": {
            opacity: "0.8",
          },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
        "shimmer-sweep": "shimmer-sweep 6s ease-in-out infinite",
        "glow-pulse": "glow-pulse 3s ease-in-out infinite",
      },
    },
  },
  plugins: [tailwindcssAnimate],
} satisfies Config;
