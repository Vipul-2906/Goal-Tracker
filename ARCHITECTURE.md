# Goal Tracker Architecture

```mermaid
flowchart LR
    Browser[Web Browser]
    Frontend[Static Frontend\nHTML, CSS, Bootstrap, Chart.js]
    API[Express API\nJWT Auth + Role Guards]
    Mongo[(MongoDB Atlas)]

    Browser --> Frontend
    Frontend --> API
    API --> Mongo

    API --> Auth[Auth + User Management]
    API --> Goals[Goal Sheets\nCreate, Submit, Approve, Unlock]
    API --> Shared[Shared Department KPIs]
    API --> Updates[Quarterly Achievement Updates]
    API --> Reports[Reports, Completion Dashboard, Audit Logs]
    API --> Cycles[Cycle Window Configuration]
```

## Hosting Choice

- Frontend: static web hosting or any low-cost object/static host.
- Backend: Node.js Express service.
- Database: MongoDB Atlas, already configured through `Backend/.env`.
- Cost control: static frontend, single API service, and one document database keep infrastructure small for the hackathon demo.
