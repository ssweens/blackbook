Feature: Plugin update
  Updating a plugin replaces its symlinks with the new version.
  Update checks compare installed version against marketplace version.

  Rule: Update replaces plugin artifacts with new version

    @UPDATE-1
    Scenario: Update plugin with new version available
      Given a plugin "eval-model" version "1.0.0" is installed
      And marketplace has version "1.1.0" available
      When the plugin is updated
      Then the plugin symlinks are refreshed
      And the installed version is now "1.1.0"

    @UPDATE-2
    Scenario: Update plugin that is already latest
      Given a plugin "eval-model" version "1.0.0" is installed
      And marketplace has version "1.0.0" as latest
      When the plugin update is attempted
      Then the update is skipped
      And a message indicates the plugin is up to date

    @UPDATE-3
    Scenario: Update adds new skills from new version
      Given a plugin "my-plugin" version "1.0.0" with skill "skill-a" is installed
      And marketplace version "1.1.0" has skills ["skill-a", "skill-b"]
      When the plugin is updated
      Then "skill-a" symlink is refreshed
      And "skill-b" symlink is created

    @UPDATE-4
    Scenario: Update removes skills no longer in new version
      Given a plugin "my-plugin" version "1.0.0" with skills ["skill-a", "skill-b"] is installed
      And marketplace version "1.1.0" has skill ["skill-a"]
      When the plugin is updated
      Then "skill-a" symlink is refreshed
      And "skill-b" symlink is removed

  Rule: Update detection

    @UPDATE-5
    Scenario: Detect available update via semantic versioning
      Given a plugin "eval-model" version "1.2.3" is installed
      And marketplace has version "1.3.0"
      When update availability is checked
      Then hasUpdate is true

    @UPDATE-6
    Scenario: No update when versions match
      Given a plugin "eval-model" version "1.0.0" is installed
      And marketplace has version "1.0.0"
      When update availability is checked
      Then hasUpdate is false

    @UPDATE-7
    Scenario: No update when installed is newer
      Given a plugin "eval-model" version "2.0.0" is installed
      And marketplace has version "1.0.0"
      When update availability is checked
      Then hasUpdate is false
