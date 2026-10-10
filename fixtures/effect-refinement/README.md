# Effect Refinement Fixture

This fixture tests Step 8c (Issue #11): **Effect refinement from handler bodies**.

## Tested Scenarios

1. `GET /safe-read`: Safe read query behind `GET` (`Item.find()`) stays `read` with no `effectEvidence`.
2. `GET /prisma-create`: Prisma `create` write behind `GET` refined to `write` with `effectEvidence` (`prisma:create`).
3. `GET /mongoose-update`: Mongoose `updateOne` behind `GET` refined to `write` with `effectEvidence` (`mongoose:updateOne`).
4. `GET /fs-write`: Node filesystem `fs.writeFileSync` behind `GET` refined to `write` with `effectEvidence` (`fs:writeFileSync`).
5. `GET /fetch-post`: Outgoing `fetch` with `method: 'POST'` behind `GET` refined to `write` with `effectEvidence` (`fetch:POST`).
6. `GET /prisma-delete`: Prisma `delete` behind `GET` refined to `destructive` with `effectEvidence` (`prisma:delete`).
7. `GET /knex-del`: Knex `del()` behind `GET` refined to `destructive` with `effectEvidence` (`knex:del`).
8. `POST /post-read-only`: `POST` method baseline is `write`. Handler only reads (`User.findById()`). Risk level is never lowered (monotonic risk rule).
9. `POST /post-delete`: `POST` method baseline is `write`. Handler executes `User.findByIdAndDelete()`. Raised to `destructive` with `effectEvidence` (`mongoose:findByIdAndDelete`).
10. `DELETE /delete-endpoint`: `DELETE` method baseline is `destructive`. Confirmed with evidence.
11. `GET /controller-write`: 1-hop imported controller (`createRecord` from `./controller.js`) calling `Record.create()` refined to `write` with provenance pointing to `controller.js`.
12. `GET /unresolvable-handler`: Unresolvable dynamic handler stays at method baseline (`read`), emitting diagnostic `DG-I001`.
