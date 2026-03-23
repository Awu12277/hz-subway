# subway-data-model

## ADDED Requirements

### Requirement: Raw city.json data format
The system SHALL parse the raw `city.json` format with top-level fields: `s` (city name), `i` (city code), `l` (lines array).

#### Scenario: Parse city.json
- **WHEN** city.json is loaded with structure `{s: "杭州市地铁", i: "3301", l: [...]}`
- **THEN** the parser SHALL extract city name, code, and lines array correctly

### Requirement: Station data from raw format
The system SHALL map raw station fields: `n` (name), `en` (english name), `p` (grid position), `sl` (geo coordinates), `lg` (line group).

#### Scenario: Station position parsing
- **WHEN** a station with `p: "1662 1158"` is parsed
- **THEN** the position SHALL be [x=1662, y=0, z=1158] for 3D rendering

### Requirement: Line data from raw format
The system SHALL map raw line fields: `ln` (line name), `cl` (color hex), `st` (stations array).

#### Scenario: Line color mapping
- **WHEN** a line with `cl: "FC0601"` is parsed
- **THEN** the line color SHALL be available as "#FC0601" for Three.js material

### Requirement: Normalized subway data structure
The system SHALL transform raw data into normalized types: `SubwayLine`, `Station`, `Train`.

#### Scenario: Transform raw to normalized
- **WHEN** raw city.json is loaded
- **THEN** the data SHALL be transformed into typed SubwayLine/Station/Train objects

### Requirement: Train data structure
The system SHALL define a Train type containing id, lineId, and speed for animation control.

#### Scenario: Train assignment
- **WHEN** a Train with id "train1", lineId "line1", speed 0.001 is defined
- **THEN** the train belongs to line1 and moves at the configured speed

### Requirement: Handle parsing errors gracefully
The system SHALL log errors and use empty/default data when city.json cannot be parsed.

#### Scenario: Load invalid JSON
- **WHEN** an invalid JSON file is loaded
- **THEN** the system SHALL log an error and use empty/default data
