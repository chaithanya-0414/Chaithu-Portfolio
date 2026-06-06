/** @type {import('tailwindcss').Config} */
module.exports = {
    content: ["./index.html"],
    darkMode: "class",
    theme: {
        extend: {
            "colors": {
                "outline-variant": "#544438",
                "on-secondary": "#2f3131",
                "on-primary": "#4d2600",
                "inverse-surface": "#e5e2e1",
                "surface-tint": "#ffb77d",
                "on-tertiary-container": "#414141",
                "tertiary-container": "#afadad",
                "secondary": "#c6c6c6",
                "inverse-primary": "#904d00",
                "on-tertiary-fixed": "#1b1c1c",
                "on-surface-variant": "#d9c2b3",
                "on-secondary-fixed": "#1a1c1c",
                "secondary-fixed-dim": "#c6c6c6",
                "on-secondary-fixed-variant": "#454747",
                "primary": "#ffbb84",
                "inverse-on-surface": "#313030",
                "on-tertiary": "#303030",
                "on-primary-fixed": "#2f1500",
                "on-tertiary-fixed-variant": "#474746",
                "tertiary-fixed": "#e4e2e1",
                "tertiary-fixed-dim": "#c8c6c5",
                "surface-container-lowest": "#0e0e0e",
                "surface-container-low": "#1c1b1b",
                "secondary-container": "#454747",
                "on-secondary-container": "#b5b5b5",
                "on-primary-fixed-variant": "#6e3900",
                "on-error-container": "#ffdad6",
                "tertiary": "#cbc8c8",
                "primary-fixed-dim": "#ffb77d",
                "outline": "#a18d7f",
                "surface-container-highest": "#353534",
                "surface-bright": "#3a3939",
                "on-primary-container": "#663500",
                "background": "#131313",
                "surface-container": "#201f1f",
                "secondary-fixed": "#e2e2e2",
                "on-surface": "#e5e2e1",
                "error": "#ffb4ab",
                "on-background": "#e5e2e1",
                "primary-fixed": "#ffdcc3",
                "primary-container": "#f2994a",
                "surface-container-high": "#2a2a2a",
                "on-error": "#690005",
                "surface-dim": "#131313",
                "error-container": "#93000a",
                "surface-variant": "#353534",
                "surface": "#131313"
            },
            "borderRadius": {
                "DEFAULT": "0.25rem",
                "lg": "0.5rem",
                "xl": "0.75rem",
                "full": "9999px"
            },
            "fontFamily": {
                "headline": ["Inter"],
                "body": ["Inter"],
                "label": ["Roboto Mono"]
            },
            "animation": {
                "marquee": "marquee 25s linear infinite",
                "gradient": "gradient 8s linear infinite",
            },
            "keyframes": {
                "marquee": {
                    "0%": { transform: "translateX(0%)" },
                    "100%": { transform: "translateX(-100%)" },
                },
                "gradient": {
                    "0%, 100%": { "background-position": "0% 50%" },
                    "50%": { "background-position": "100% 50%" },
                }
            }
        },
    },
    plugins: [],
}
