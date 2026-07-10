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
      ctaSecondary: 'How it works',
      figure: {
        caption: 'Network W1. Looped layout',
        sheet: 'Sheet 1',
      },
      how: {
        kicker: 'Process',
        title: 'From surveys to drawings',
        steps: {
          s1: {
            title: 'Input data',
            text: 'Upload a CSV or GeoJSON survey, place the buildings and set the source. Missing parameters are taken from the codes and clearly flagged.',
          },
          s2: {
            title: 'Routing',
            text: 'The system builds a digital terrain model and traces a looped network from the source to every building around the development.',
          },
          s3: {
            title: 'Hydraulics',
            text: 'EPANET computes flow distribution, velocities and heads. Diameters are selected iteratively from the standard series.',
          },
          s4: {
            title: 'Deliverables',
            text: 'DXF drawings for AutoCAD, a PDF explanatory note and an XLSX bill of materials.',
          },
        },
      },
      features: {
        kicker: 'Capabilities',
        title: 'The full engineering cycle',
        items: {
          f1: {
            title: 'Water demand',
            text: 'Design flows per SP RK 4.01-101 with peak factors and fire fighting demand.',
          },
          f2: {
            title: 'Looped layout',
            text: 'Looping delivers reliability and even supply. Dead ends only where the codes allow them.',
          },
          f3: {
            title: 'Service pressure',
            text: 'Every building gets pressure within the code range. Problem nodes are highlighted with recommendations.',
          },
          f4: {
            title: 'Pipe materials',
            text: 'PE100, ductile iron, steel, PVC. Selection follows soils, groundwater, seismicity and working pressure.',
          },
          f5: {
            title: 'Seismic and hazards',
            text: 'Site seismicity, subsidence and flooding are reflected in materials and joints.',
          },
          f6: {
            title: 'Fittings and structures',
            text: 'Gate valves, hydrants at most 150 m apart, air valves, washouts and manholes are placed automatically.',
          },
        },
      },
      outputs: {
        kicker: 'Output',
        title: 'A package you can build from',
        items: {
          o1: {
            title: 'DXF drawings',
            text: 'Network plan on the survey base at 1:500, longitudinal profiles of mains and manhole schedules. Layers follow GOST 21.704. Opens in AutoCAD.',
          },
          o2: {
            title: 'Explanatory note',
            text: 'Input data, methodology, hydraulic calculation tables, pressure checks and design justifications with code references.',
          },
          o3: {
            title: 'Bill of materials',
            text: 'Pipes by diameter and length, fittings, valves, hydrants and manholes.',
          },
        },
      },
      norms: {
        kicker: 'Normative base',
        title: 'Every formula cites its clause',
        items: {
          n1: {
            code: 'SP RK 4.01-101-2012',
            name: 'Water supply. Outdoor networks and structures',
          },
          n2: {
            code: 'SP RK 2.03-30-2017',
            name: 'Construction in seismic zones',
          },
          n3: {
            code: 'GOST 21.704-2011',
            name: 'Rules for working documentation of outdoor water supply networks',
          },
          n4: {
            code: 'SNiP 2.04.02-84*',
            name: 'Reference. Hydraulic calculation methodology',
          },
        },
      },
      ctaBand: {
        title: 'Upload the surveys and receive a finished design',
        button: 'Get started',
      },
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
