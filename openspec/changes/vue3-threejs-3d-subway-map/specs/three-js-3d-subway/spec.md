# three-js-3d-subway

## ADDED Requirements

### Requirement: Render subway lines as 3D curves
The system SHALL render subway lines as smooth 3D curves using Three.js CatmullRomCurve3, with configurable line width and color per line.

#### Scenario: Render line 1 and line 2
- **WHEN** subway data is loaded
- **THEN** only 1号线 and 2号线 SHALL be rendered initially

### Requirement: Display stations as 3D markers
The system SHALL display each station as a 3D geometric shape (sphere or cylinder) at the correct geographic position.

#### Scenario: Station marker visibility
- **WHEN** a station is within the camera view frustum
- **THEN** the station marker SHALL be rendered and visible

#### Scenario: Station marker scale
- **WHEN** the camera zooms in/out
- **THEN** station markers SHALL maintain readable size relative to the scene

### Requirement: Rotating arrow above each station
The system SHALL display a rotating arrow above each station marker.

#### Scenario: Arrow rotation animation
- **WHEN** a station marker is rendered
- **THEN** an arrow SHALL be positioned above it and SHALL rotate continuously around the Y-axis

### Requirement: Station name labels face camera (billboard effect)
The system SHALL render station name labels that always face the camera using billboard sprites.

#### Scenario: Label billboard behavior
- **WHEN** the camera rotates around the scene
- **THEN** station name labels SHALL always face the camera and be readable

### Requirement: Animate trains along tracks
The system SHALL animate train models moving along the subway curves at configurable speeds.

#### Scenario: Train movement
- **WHEN** a train object exists on a line curve
- **THEN** the train position SHALL interpolate along the curve from t=0 to t=1 continuously

#### Scenario: Multiple trains per line
- **WHEN** multiple trains are assigned to the same line
- **THEN** each train SHALL have an independent position and speed

#### Scenario: Train wraps around
- **WHEN** a train reaches t=1 (end of line)
- **THEN** the train SHALL reset to t=0 and continue moving

### Requirement: Support 3D camera controls
The system SHALL allow users to rotate, zoom, and pan the 3D view using mouse/touch input.

#### Scenario: Rotate view
- **WHEN** user drags on the canvas
- **THEN** the camera SHALL orbit around the scene center

#### Scenario: Zoom in/out
- **WHEN** user scrolls mouse wheel
- **THEN** the camera SHALL zoom in/out maintaining orbit center

#### Scenario: Pan view
- **WHEN** user right-drags or two-finger drags
- **THEN** the camera SHALL pan horizontally and vertically
