# Changelog

All notable changes to `@fleetless/contracts` are recorded here. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the
project uses [semantic versioning](https://semver.org/spec/v2.0.0.html) over
the wire shapes.

## [1.0.0] — unreleased

The first published version. Nothing about the shapes changes with it: they are
exactly the shapes the Fleetless cloud serves at release 0.17.0, and they have
been the contract between the cloud, the console, the SDK and the robot-side
bridge for as long as those have existed. What changes is who can read them —
until now this package was resolvable only from a private git URL, so nobody
outside the project could build a Fleetless client from source.

Consumers should pin an exact version. A range cannot express "compatible with
the server you are talking to", and that is the only compatibility question
these schemas answer. Any change that makes a previously valid message invalid
— a new required field, a narrowed bound, a removed enum member, a renamed
error code — is a **major** version, without exception and regardless of how
small it looks from inside the repository.

Published under Apache-2.0. The JSON Schema and OpenAPI artifacts ship in the
package under `artifacts/` and are importable by path, which is what a consumer
in another language needs.
