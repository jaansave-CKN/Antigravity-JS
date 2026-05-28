---
name: Global Grant Nexus
colors:
  surface: '#00101c'
  surface-dim: '#00101c'
  surface-bright: '#002f49'
  surface-container-lowest: '#000000'
  surface-container-low: '#001524'
  surface-container: '#001c2e'
  surface-container-high: '#002237'
  surface-container-highest: '#002840'
  on-surface: '#d1e8ff'
  on-surface-variant: '#8bafcf'
  inverse-surface: '#f7f9ff'
  inverse-on-surface: '#345875'
  outline: '#557997'
  outline-variant: '#254b67'
  surface-tint: '#60c9ff'
  primary: '#60c9ff'
  on-primary: '#003f58'
  primary-container: '#01bdfe'
  on-primary-container: '#00354a'
  inverse-primary: '#00668b'
  secondary: '#2ba9f5'
  on-secondary: '#00253c'
  secondary-container: '#006496'
  on-secondary-container: '#f4f8ff'
  tertiary: '#9da0ff'
  on-tertiary: '#161384'
  tertiary-container: '#8d90fc'
  on-tertiary-container: '#070071'
  error: '#ff716c'
  on-error: '#490006'
  error-container: '#9f0519'
  on-error-container: '#ffa8a3'
  primary-fixed: '#01bdfe'
  primary-fixed-dim: '#00afeb'
  on-primary-fixed: '#001a27'
  on-primary-fixed-variant: '#003e56'
  secondary-fixed: '#a9d7ff'
  secondary-fixed-dim: '#8acaff'
  on-secondary-fixed: '#003756'
  on-secondary-fixed-variant: '#005581'
  tertiary-fixed: '#a6a9ff'
  tertiary-fixed-dim: '#9699ff'
  on-tertiary-fixed: '#050061'
  on-tertiary-fixed-variant: '#282993'
  primary-dim: '#00afeb'
  secondary-dim: '#26a6f2'
  tertiary-dim: '#9093ff'
  error-dim: '#d7383b'
  background: '#00101c'
  on-background: '#d1e8ff'
  surface-variant: '#002840'
typography:
  headline-xl:
    fontFamily: Hanken Grotesk
    fontSize: 48px
    fontWeight: '700'
    lineHeight: 56px
    letterSpacing: -0.02em
  headline-lg:
    fontFamily: Hanken Grotesk
    fontSize: 32px
    fontWeight: '600'
    lineHeight: 40px
    letterSpacing: -0.01em
  headline-md:
    fontFamily: Hanken Grotesk
    fontSize: 24px
    fontWeight: '600'
    lineHeight: 32px
  body-lg:
    fontFamily: Hanken Grotesk
    fontSize: 18px
    fontWeight: '400'
    lineHeight: 28px
  body-md:
    fontFamily: Hanken Grotesk
    fontSize: 16px
    fontWeight: '400'
    lineHeight: 24px
  body-sm:
    fontFamily: Hanken Grotesk
    fontSize: 14px
    fontWeight: '400'
    lineHeight: 20px
  label-md:
    fontFamily: JetBrains Mono
    fontSize: 12px
    fontWeight: '500'
    lineHeight: 16px
    letterSpacing: 0.05em
  label-sm:
    fontFamily: JetBrains Mono
    fontSize: 10px
    fontWeight: '600'
    lineHeight: 14px
    letterSpacing: 0.08em
  headline-lg-mobile:
    fontFamily: Hanken Grotesk
    fontSize: 28px
    fontWeight: '600'
    lineHeight: 36px
rounded:
  sm: 0.125rem
  DEFAULT: 0.25rem
  md: 0.375rem
  lg: 0.5rem
  xl: 0.75rem
  full: 9999px
spacing:
  unit: 4px
  xs: 4px
  sm: 8px
  md: 16px
  lg: 24px
  xl: 32px
  container-max: 1440px
  gutter: 20px
---

## Brand & Style

The design system is engineered for the high-stakes world of international philanthropy and institutional funding. The brand personality is **authoritative, analytical, and global**. It communicates reliability through a rigorous, systematic UI that handles dense data without overwhelming the user.

The visual style is a hybrid of **Modern Corporate** and **Vibrant Technical Minimalism**. It utilizes an energetic dark mode aesthetic—moving beyond standard dark mode into a sophisticated palette of steel blues and vibrant cyans to maintain high engagement during long periods of data entry and research. The emotional response is one of "dynamic precision" and "unwavering trust."

**Key Principles:**
- **Information Density over Whitespace:** Prioritize clarity of data relationships over sprawling layouts.
- **Precision Indicators:** Use vibrant, high-energy accent colors strictly for status, tags, and actionable data points.
- **Global Accessibility:** Maintain high legibility standards for a multilingual, international user base.

## Colors

The palette is anchored in **Muted Steel** and **Vibrant Cyan**. This provides a high-contrast foundation where colors signify different grant types and priorities with increased intensity.

- **Primary (Vibrant Cyan):** Used for primary actions, active states, and critical links. It provides maximum visibility against the dark backdrop.
- **Secondary (Bright Azure):** Used for institutional branding and secondary data categories, offering a professional blue-tone variation.
- **Tertiary (Vibrant Lavender):** A punchy, saturated purple-blue used for specialized grouping, subtle highlights, or contrasting background elements within data visualizations.
- **Neutrals (Steel Blue):** A scale of mid-to-deep blue-grays ensures that borders and secondary text remain visible while adding more "color" to the interface than traditional grays.
- **Layering:** Use the deep steel-blue backgrounds as the base layer, creating containers that feel unified with the brand color story rather than purely achromatic.

## Typography

This design system uses **Hanken Grotesk** as its primary typeface to provide a clean, contemporary sans-serif look that feels professional yet approachable. 

For technical data—such as grant IDs, monetary values, and dates—**JetBrains Mono** is employed. The monospaced nature of the label font ensures that columns of numbers remain perfectly aligned, aiding in rapid data scanning.

**Hierarchy Rules:**
- Use `headline-lg` for directory section titles.
- Use `body-md` for general descriptive text.
- Use `label-md` (All Caps) for table headers and metadata tags to distinguish them clearly from the primary content.
- Increase tracking (letter spacing) slightly for labels to improve readability at small sizes on dark backgrounds.

## Layout & Spacing

The system utilizes a **12-column fluid grid** for internal dashboards and a **Fixed Grid** (max 1440px) for the public directory. 

**Spacing Rhythm:**
A strict 4px base unit is used to manage high density.
- **Tables/Lists:** Use 12px vertical padding for list items to maximize data visibility while maintaining touch targets.
- **Margins:** Use 24px margins on mobile, scaling to 48px+ on desktop to provide visual "breathing room" around the central data density.
- **Gutters:** Standardized 20px gutters allow for distinct separation between sidebars/filters and the main content feed.

**Breakpoints:**
- **Mobile (<768px):** Single column. Filters move to a bottom sheet or full-screen overlay.
- **Tablet (768px - 1024px):** Condensed sidebar (icons only) or top-tier navigation.
- **Desktop (>1024px):** Full persistent sidebar with multi-column data views.

## Elevation & Depth

To maintain a sleek, modern aesthetic, the design system avoids traditional heavy shadows. Depth is communicated through **Tonal Layering** and **High-Vibrancy Outlines**.

- **Level 0 (Background):** Deepest steel blue base.
- **Level 1 (Cards/Containers):** Elevated steel surfaces with increased saturation.
- **Level 2 (Modals/Popovers):** Surface layers with a very soft, diffused ambient shadow (10% opacity) to separate it from the background.
- **Interaction:** On hover, cards should transition their border color to the primary vibrant cyan (`#00BDFE`) rather than increasing shadow depth. This reinforces the "technical" feel.

## Shapes

The shape language is **Soft (0.25rem)**. This provides enough rounding to feel modern and accessible while maintaining a structured, professional "grid" feel.

- **Buttons & Inputs:** 4px (0.25rem) corner radius.
- **Large Containers/Cards:** 8px (0.5rem) corner radius.
- **Status Tags/Chips:** Fully rounded (pill-shaped) to distinguish them from actionable buttons.

## Components

### Buttons
- **Primary:** Solid Vibrant Cyan with deep neutral text. No gradients.
- **Secondary:** Ghost style (Steel Blue border) with Vibrant Cyan text.
- **Size:** Compact (32px height) for data-heavy rows; Standard (44px height) for global actions.

### Chips & Tags
- **Data Tags:** Subtle background (15% opacity of accent color) with 100% opacity text.
- **Status Tags:** Pill-shaped with a 1px border matching the status color.

### Inputs & Search
- **Search Bar:** Large, prominent with a 1px neutral border. Use a JetBrains Mono placeholder for a technical aesthetic.
- **Filter Checkboxes:** Custom square boxes with a 2px radius and Vibrant Cyan checkmark.

### Data Cards
- Use horizontal layouts for the directory.
- **Left Edge:** Flag or Country Code (Monospace).
- **Center:** Organization and Grant Title (Bold Hanken).
- **Right:** Metadata cluster (Amount, Deadline, Tags) using `label-sm` for secondary info.

### Lists
- Use thin horizontal dividers between entries. 
- Highlight the entire row on hover with a 5% opacity primary color overlay.