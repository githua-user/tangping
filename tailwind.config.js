import tailwindcssAnimate from "tailwindcss-animate";

/** @type {import('tailwindcss').Config} */

export default {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    container: {
      center: true,
    },
    extend: {
      keyframes: {
        'fog-a': {
          '0%, 100%': { transform: 'translate(0, 0) scale(1)' },
          '50%': { transform: 'translate(70px, -50px) scale(1.15)' },
        },
        'fog-b': {
          '0%, 100%': { transform: 'translate(0, 0) scale(1.1)' },
          '50%': { transform: 'translate(-60px, 60px) scale(0.9)' },
        },
      },
      animation: {
        'fog-a': 'fog-a 18s ease-in-out infinite',
        'fog-b': 'fog-b 26s ease-in-out infinite',
      },
    },
  },
  plugins: [tailwindcssAnimate],
};
