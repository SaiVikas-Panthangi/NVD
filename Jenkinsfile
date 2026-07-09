pipeline {
  agent any

  triggers {
    cron('''TZ=Asia/Kolkata
H 9-23 * * *''')
  }

  options {
    disableConcurrentBuilds()
    timestamps()
  }

  environment {
    // Configure this in Jenkins Credentials and bind it in the job if preferred.
    TEAMS_WEBHOOK_URL = credentials('dashboard-alerts-teams-webhook')
  }

  stages {
    stage('Checkout') {
      steps {
        checkout scm
      }
    }

    stage('Install Dependencies') {
      steps {
        script {
          if (isUnix()) {
            sh 'npm install'
          } else {
            bat 'npm install'
          }
        }
      }
    }

    stage('Run Monitor') {
      steps {
        script {
          if (isUnix()) {
            sh 'npm run monitor:run'
          } else {
            bat 'npm run monitor:run'
          }
        }
      }
    }
  }

  post {
    always {
      archiveArtifacts artifacts: 'reports/**, logs/**, data/**', allowEmptyArchive: true
    }
  }
}
