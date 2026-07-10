export const en = {
  translation: {
    nav: {
      app: 'Application',
    },
    landing: {
      kicker: 'Outdoor water supply networks',
      title: 'Upload the surveys. Receive the design.',
      description:
        'AquaScheme traces a looped network from the source to every building, runs hydraulic calculations with EPANET, selects pipe diameters and materials and produces DXF drawings, an explanatory note and a bill of materials.',
      cta: 'Open the application',
    },
    app: {
      title: 'Projects',
      placeholder:
        'Application workspace. The project list and the creation wizard arrive in the next phases.',
      engine: 'engine v{{version}}',
      db: {
        checking: 'Checking database connection',
        ok: 'Database connected',
        noSchema:
          'Database schema not found. Run backend/migrations/0001_init.sql in the Supabase SQL Editor',
        error: 'No database connection',
      },
    },
    notFound: {
      title: 'Page not found',
      back: 'Back to home',
    },
    footer: {
      disclaimer: 'A design automation tool. Final decisions rest with the engineer',
      norms: 'SP RK 4.01-101-2012',
    },
  },
}
