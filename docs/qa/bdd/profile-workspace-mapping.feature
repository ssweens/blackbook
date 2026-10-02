Feature: Profile ↔ workspace mapping
  A workspace (a project, or Global = $HOME) records the profiles assigned to it
  in its OWN lock — a top-level "profiles" array in its skills-lock.json (the
  global lock for Global). The mapping therefore travels with the repo and an
  auto-detected workspace shows its profiles on any machine.

  Applying a profile to a workspace assigns it. "Up to date with this
  workspace" means every profile skill is in the workspace lock from the same
  source, installed on disk in the workspace's agent skills directory, not
  drifted from its source, and nothing dropped from the profile lingers.

  Rule: The mapping lives in the workspace's own lock

    @MAP-1
    Scenario: Assigning a profile writes it into the workspace lock's profiles meta
      Given a workspace whose lock lists skills ["docx"]
      When profile "Docs" is assigned to the workspace
      Then the workspace lock's profiles are ["Docs"]
      And the workspace lock still lists skills ["docx"]

    @MAP-2
    Scenario: Assigning is idempotent and keeps profiles sorted
      Given a workspace whose lock lists skills ["docx"]
      When profile "UI" is assigned to the workspace
      And profile "Docs" is assigned to the workspace
      And profile "UI" is assigned to the workspace
      Then the workspace lock's profiles are ["Docs", "UI"]

    @MAP-3
    Scenario: Unassigning removes the profile and drops the key when empty
      Given a workspace whose lock lists skills ["docx"]
      And profile "Docs" is assigned to the workspace
      When profile "Docs" is unassigned from the workspace
      Then the workspace lock has no profiles meta
      And the workspace lock still lists skills ["docx"]

    @MAP-4
    Scenario: The mapping travels with the repo
      Given a workspace lock written on another machine with profiles ["Coding", "UI"] and skills ["deslop"]
      When the workspace lock is read
      Then the workspace's profiles are ["Coding", "UI"]

    @MAP-5
    Scenario: Nothing is fabricated when the workspace has no lock yet
      Given a workspace with no lock file
      When profile "Docs" is assigned to the workspace
      Then the assignment is refused
      And the workspace still has no lock file

  Rule: "Up to date with this workspace" means in the lock, on disk, and matching the source

    @MAP-6
    Scenario: Up to date when the profile's skills are in the lock and installed
      Given a workspace whose lock lists skills ["docx", "pdf"]
      And a profile "Docs" listing skills ["docx", "pdf"]
      And profile "Docs" is assigned to the workspace
      And "docx" is installed in the agent skills directory
      And "pdf" is installed in the agent skills directory
      When the status of "Docs" against the workspace is computed
      Then the profile is assigned
      And the profile is up to date

    @MAP-7
    Scenario: Not up to date when skills are in the lock but missing on disk
      Given a workspace whose lock lists skills ["docx", "pdf"]
      And a profile "Docs" listing skills ["docx", "pdf"]
      And profile "Docs" is assigned to the workspace
      And "docx" is installed in the agent skills directory
      When the status of "Docs" against the workspace is computed
      Then the profile is not up to date
      And 1 skill is to apply

    @MAP-8
    Scenario: Not up to date when a skill is missing from the workspace lock entirely
      Given a workspace whose lock lists skills ["docx"]
      And a profile "Docs" listing skills ["docx", "pdf"]
      And profile "Docs" is assigned to the workspace
      And "docx" is installed in the agent skills directory
      When the status of "Docs" against the workspace is computed
      Then the profile is not up to date
      And 1 skill is to apply

    @MAP-9
    Scenario: Not up to date when an installed skill drifted from its source
      Given a workspace whose lock lists skills ["deslop"]
      And a profile "Coding" listing skills ["deslop"]
      And profile "Coding" is assigned to the workspace
      And the source repo has "deslop" with content "original"
      And "deslop" is installed in the agent skills directory with content "edited"
      When the status of "Coding" against the workspace is computed
      Then the profile is not up to date
      And 1 skill is drifted

    @MAP-10
    Scenario: A profile the workspace does not track is reported as not assigned
      Given a workspace whose lock lists skills ["docx"]
      And a profile "Docs" listing skills ["docx"]
      And "docx" is installed in the agent skills directory
      When the status of "Docs" against the workspace is computed
      Then the profile is not assigned

    @MAP-11
    Scenario: A skill the source repo no longer has is reported and never planned
      Given a workspace whose lock lists skills ["deslop", "thread-map"] from the source repo "ssweens/playbook"
      And a profile "Coding" from the source repo "ssweens/playbook" listing skills ["deslop", "thread-map"]
      And profile "Coding" is assigned to the workspace
      And the source repo has "deslop" with content "original"
      And "deslop" is installed in the agent skills directory with content "original"
      When the status of "Coding" against the workspace is computed
      Then the profile is not up to date
      And 1 skill is not in the source repo
      And 0 skills are to apply
      And the status summary is "1 not in source repo"

  Rule: Profiles applied before the mapping existed are not lost

    @MAP-12
    Scenario: A legacy apply (snapshot only, no lock meta) still counts as assigned
      Given a workspace whose lock lists skills ["docx"]
      And a profile "Docs" listing skills ["docx"]
      And "docx" is installed in the agent skills directory
      And profile "Docs" was applied to the workspace before the mapping existed
      When the status of "Docs" against the workspace is computed
      Then the profile is assigned
      And the profile is up to date

    @MAP-13
    Scenario: Unassigning a legacy apply clears it too
      Given a workspace whose lock lists skills ["docx"]
      And a profile "Docs" listing skills ["docx"]
      And profile "Docs" was applied to the workspace before the mapping existed
      When profile "Docs" is unassigned from the workspace
      And the status of "Docs" against the workspace is computed
      Then the profile is not assigned

  Rule: Renaming or deleting a profile keeps workspace assignments honest

    @MAP-14
    Scenario: Renaming a profile carries its assignments to the new name
      Given a workspace whose lock lists skills ["docx"]
      And profile "Docs" is assigned to the workspace
      When profile "Docs" is renamed to "Documents" everywhere
      Then the workspace lock's profiles are ["Documents"]

    @MAP-15
    Scenario: Deleting a profile removes its assignment from every workspace
      Given a workspace whose lock lists skills ["docx"]
      And profile "Docs" is assigned to the workspace
      When profile "Docs" is unassigned everywhere
      Then the workspace lock has no profiles meta
