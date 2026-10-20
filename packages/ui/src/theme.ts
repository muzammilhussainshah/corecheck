// Plain component settings, not Component.extend(): server components import
// this module too, where Mantine's components are client references.
import { createTheme, type MantineColorsTuple } from '@mantine/core';

/**
 * Colours shared with the CoreStock pattern: the dark sidebar, the warm grey
 * page, slate text. The brand blue comes from the CoreCheck Figma file.
 */
export const COLORS = {
  page: '#F4F3F3',
  sidebar: '#3A3E46',
  sidebarText: '#F8FAFC',
  sidebarMuted: '#9CA3AF',
  title: '#202939',
  body: '#4B5565',
  muted: '#697586',
  border: '#EEF2F6',
  borderStrong: '#E5E7EB',
  tableHead: '#F8FAFC',
  panel: '#FCFCFD',
  secondaryBorder: '#CDD5DF',
  secondaryText: '#364152',
} as const;

/** Figma blue (#4C92F3 at index 4); buttons use index 7 for readable white text. */
const brand: MantineColorsTuple = [
  '#eaf3fe',
  '#d4e5fd',
  '#a6c8f9',
  '#75a9f6',
  '#4c92f3',
  '#3584f2',
  '#257cf2',
  '#166ad8',
  '#055ec2',
  '#0050ab',
];

// --font-satoshi / --font-manrope are set by next/font in each app's layout.
const BODY_FONT =
  'var(--font-satoshi), Satoshi, "Segoe UI", system-ui, -apple-system, Roboto, Arial, sans-serif';
const HEADING_FONT =
  'var(--font-manrope), Manrope, "Segoe UI", system-ui, -apple-system, Roboto, Arial, sans-serif';

export const theme = createTheme({
  primaryColor: 'brand',
  primaryShade: { light: 7, dark: 6 },
  colors: { brand },
  defaultRadius: 'md',
  fontFamily: BODY_FONT,
  headings: { fontFamily: HEADING_FONT, fontWeight: '600' },
  black: COLORS.title,
  // Visible keyboard focus everywhere (NFR-006).
  focusRing: 'auto',
  components: {
    // Help text sits under the input so fields sharing a row stay aligned.
    InputWrapper: {
      defaultProps: {
        inputWrapperOrder: ['label', 'input', 'description', 'error'],
      },
      styles: {
        label: {
          fontWeight: 500,
          marginBottom: 6,
          color: COLORS.secondaryText,
        },
        description: { marginTop: 4 },
      },
    },
    Button: {
      styles: { root: { height: 40, fontWeight: 600 } },
    },
    Modal: {
      defaultProps: { centered: true, radius: 'lg' },
      styles: {
        title: {
          fontFamily: HEADING_FONT,
          fontWeight: 600,
          fontSize: 'var(--mantine-font-size-xl)',
          color: COLORS.title,
        },
      },
    },
    Fieldset: {
      defaultProps: { radius: 'lg' },
      styles: {
        root: {
          backgroundColor: COLORS.panel,
          borderColor: COLORS.border,
        },
        legend: {
          fontFamily: HEADING_FONT,
          fontWeight: 600,
          fontSize: 'var(--mantine-font-size-sm)',
          color: COLORS.title,
          paddingInline: 6,
        },
      },
    },
    Card: {
      defaultProps: { padding: 'lg', radius: 'lg' },
      styles: { root: { borderColor: COLORS.border } },
    },
    Paper: { defaultProps: { radius: 'lg' } },
    Badge: {
      defaultProps: { radius: 'xl' },
      styles: { root: { textTransform: 'none', fontWeight: 600 } },
    },
    // CoreStock tables: pale grey heading row, slate cell text.
    Table: {
      styles: {
        th: {
          backgroundColor: COLORS.tableHead,
          fontSize: 14,
          fontWeight: 500,
          color: COLORS.muted,
          whiteSpace: 'nowrap',
        },
        td: { verticalAlign: 'middle', color: COLORS.body, fontWeight: 500 },
      },
    },
  },
});
