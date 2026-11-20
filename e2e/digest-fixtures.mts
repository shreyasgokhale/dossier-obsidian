// Synthetic API payloads only. All employers, vacancies and URLs are made up.
export function digestFixture(
  path: string,
): { status: number; body: unknown } | null {
  const date = new Date().toISOString();
  const description =
    "Design complex tools with Figma, product research and prototyping. Five years of product design experience. Berlin hybrid team. Salary and language requirements to be confirmed.";
  if (path === "/arbeitnow/api/job-board-api")
    return {
      status: 200,
      body: {
        data: [
          {
            slug: "demo-senior",
            title: "Senior Product Designer",
            company_name: "Demo Spree Tools",
            location: "Berlin",
            description,
            remote: false,
            url: "https://jobs.example/demo-spree",
            created_at: Math.floor(Date.now() / 1000),
          },
          {
            slug: "demo-remote",
            title: "Product Designer",
            company_name: "Demo Fern Studio",
            location: "Berlin / Remote",
            description,
            remote: true,
            url: "https://jobs.example/demo-fern",
            created_at: Math.floor(Date.now() / 1000),
          },
        ],
      },
    };
  if (path === "/daily_berlin/api/v1/jobs")
    return {
      status: 200,
      body: {
        count: 2,
        jobs: [
          {
            id: 101,
            title: "Senior Product Designer",
            company: "Demo Spree Tools",
            location: "Berlin",
            url: "https://jobs.example/demo-spree?utm_source=board",
            work_mode: "Hybrid",
            posted_date: date,
            source: "ats",
          },
          {
            id: 102,
            title: "Lead Product Designer",
            company: "Demo Canal Labs",
            location: "Berlin",
            url: "https://jobs.example/demo-canal",
            work_mode: "Hybrid",
            posted_date: date,
            source: "ats",
          },
        ],
      },
    };
  if (path === "/company_boards/greenhouse/demo")
    return {
      status: 200,
      body: {
        jobs: [
          {
            id: 301,
            title: "Senior Product Designer",
            location: { name: "Berlin" },
            content: description,
            absolute_url: "https://jobs.example/demo-greenhouse",
            first_published: date,
          },
        ],
      },
    };
  if (path === "/company_boards/ashby/demo")
    return {
      status: 200,
      body: {
        jobs: [
          {
            id: "401",
            title: "Product Designer",
            location: "Berlin",
            descriptionPlain: description,
            jobUrl: "https://jobs.example/demo-ashby",
            isRemote: true,
            publishedAt: date,
          },
        ],
      },
    };
  if (path === "/company_boards/lever/unavailable")
    return { status: 503, body: { error: "Synthetic source outage" } };
  if (path === "/company_boards/lever/demo")
    return {
      status: 200,
      body: [
        {
          id: "501",
          text: "Product Designer",
          categories: { location: "Berlin" },
          descriptionPlain: description,
          hostedUrl: "https://jobs.example/demo-lever",
          workplaceType: "remote",
          createdAt: Date.now(),
        },
      ],
    };
  return null;
}
