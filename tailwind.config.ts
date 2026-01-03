import type { Config } from "tailwindcss";

export default {
  darkMode: ["class"],
  content: ["./pages/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./app/**/*.{ts,tsx}", "./src/**/*.{ts,tsx}"],
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
      fontSize: {
        // Reduced by 2px from Tailwind defaults
        'xs': ['0.625rem', { lineHeight: '0.875rem' }],   // 10px (was 12px)
        'sm': ['0.75rem', { lineHeight: '1rem' }],        // 12px (was 14px)
        'base': ['0.875rem', { lineHeight: '1.25rem' }],  // 14px (was 16px)
        'lg': ['1rem', { lineHeight: '1.5rem' }],         // 16px (was 18px)
        'xl': ['1.125rem', { lineHeight: '1.625rem' }],   // 18px (was 20px)
        '2xl': ['1.375rem', { lineHeight: '1.875rem' }],  // 22px (was 24px)
        '3xl': ['1.625rem', { lineHeight: '2.125rem' }],  // 26px (was 30px)
        '4xl': ['2rem', { lineHeight: '2.375rem' }],      // 32px (was 36px)
        '5xl': ['2.625rem', { lineHeight: '1' }],         // 42px (was 48px)
      },
      fontFamily: {
        'sans': ['system-ui', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'sans-serif'],
        'mono': ['SF Mono', 'Monaco', 'Inconsolata', 'Roboto Mono', 'Consolas', 'monospace'],
        'thuast': ['Thuast', 'system-ui', 'sans-serif'],
      },
      colors: {
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
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
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
        success: {
          DEFAULT: "hsl(var(--success))",
          foreground: "hsl(var(--success-foreground))",
        },
        warning: {
          DEFAULT: "hsl(var(--warning))",
          foreground: "hsl(var(--warning-foreground))",
        },
        viewer: {
          bg: "hsl(var(--viewer-bg))",
          grid: "hsl(var(--viewer-grid))",
          "axis-x": "hsl(var(--viewer-axis-x))",
          "axis-y": "hsl(var(--viewer-axis-y))",
          "axis-z": "hsl(var(--viewer-axis-z))",
        },
      },
      backgroundImage: {
        "gradient-mesh": "var(--gradient-mesh)",
        "gradient-tech": "var(--gradient-tech)",
        "gradient-glass": "var(--gradient-glass)",
      },
      boxShadow: {
        soft: "var(--shadow-soft)",
        tech: "var(--shadow-tech)",
        glow: "var(--shadow-glow)",
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
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
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
} satisfies Config;
