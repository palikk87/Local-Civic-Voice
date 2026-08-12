import React, { useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  SafeAreaView,
  TextInput,
  Modal,
  Alert,
} from 'react-native';
import { useRouter } from 'expo-router';
import {
  ArrowLeft,
  FileText,
  Download,
  Calendar,
  Filter,
  X,
  CheckCircle,
  Clock,
  Mail,
  Building2,
  Target,
  Map,
  TrendingUp,
} from 'lucide-react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useB2BStore } from '@/lib/b2b-store';
import * as Haptics from 'expo-haptics';

interface ReportTemplateProps {
  title: string;
  description: string;
  icon: React.ReactNode;
  onGenerate: () => void;
}

function ReportTemplate({ title, description, icon, onGenerate }: ReportTemplateProps) {
  return (
    <TouchableOpacity
      onPress={onGenerate}
      className="bg-slate-800/30 border border-slate-700/50 rounded-2xl p-4 mb-3"
    >
      <View className="flex-row items-start">
        <View className="w-12 h-12 bg-indigo-500/20 rounded-xl items-center justify-center">
          {icon}
        </View>
        <View className="flex-1 ml-3">
          <Text className="text-white font-semibold text-base">{title}</Text>
          <Text className="text-slate-400 text-sm mt-1">{description}</Text>
        </View>
        <View className="bg-indigo-500/20 p-2 rounded-lg">
          <Download size={18} color="#818CF8" />
        </View>
      </View>
    </TouchableOpacity>
  );
}

interface GeneratedReportProps {
  id: string;
  title: string;
  generatedAt: string;
  status: 'completed' | 'processing' | 'failed';
  format: 'pdf' | 'csv';
}

function GeneratedReport({ id, title, generatedAt, status, format }: GeneratedReportProps) {
  const getStatusStyle = () => {
    switch (status) {
      case 'completed':
        return { icon: <CheckCircle size={16} color="#34D399" />, text: 'text-emerald-400', bg: 'bg-emerald-500/10' };
      case 'processing':
        return { icon: <Clock size={16} color="#FBBF24" />, text: 'text-amber-400', bg: 'bg-amber-500/10' };
      case 'failed':
        return { icon: <X size={16} color="#EF4444" />, text: 'text-red-400', bg: 'bg-red-500/10' };
    }
  };

  const statusStyle = getStatusStyle();

  return (
    <View className="flex-row items-center justify-between py-3 border-b border-slate-700/30">
      <View className="flex-row items-center flex-1">
        <View className={`w-10 h-10 rounded-lg items-center justify-center ${statusStyle.bg}`}>
          <FileText size={20} color="#818CF8" />
        </View>
        <View className="ml-3 flex-1">
          <Text className="text-white font-medium">{title}</Text>
          <Text className="text-slate-400 text-xs">{generatedAt}</Text>
        </View>
      </View>
      <View className="flex-row items-center">
        <View className={`px-2 py-1 rounded-full mr-2 ${statusStyle.bg}`}>
          <Text className={`text-xs capitalize ${statusStyle.text}`}>{status}</Text>
        </View>
        {status === 'completed' && (
          <TouchableOpacity className="bg-slate-700/50 p-2 rounded-lg">
            <Download size={16} color="#94A3B8" />
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

export default function B2BReportsScreen() {
  const router = useRouter();
  const [showCustomReport, setShowCustomReport] = useState(false);
  const [dateRange, setDateRange] = useState('7');
  const [selectedStates, setSelectedStates] = useState<string[]>([]);
  const [selectedIssues, setSelectedIssues] = useState<string[]>([]);
  const [reportFormat, setReportFormat] = useState<'pdf' | 'csv'>('pdf');
  const [email, setEmail] = useState('');

  const session = useB2BStore((s) => s.session);

  // Mock generated reports
  const generatedReports: GeneratedReportProps[] = [
    {
      id: '1',
      title: 'Weekly Sentiment Summary',
      generatedAt: 'Mar 3, 2026 at 9:00 AM',
      status: 'completed',
      format: 'pdf',
    },
    {
      id: '2',
      title: 'Healthcare Issue Analysis',
      generatedAt: 'Mar 2, 2026 at 3:30 PM',
      status: 'completed',
      format: 'pdf',
    },
    {
      id: '3',
      title: 'Custom State Report - CA, TX, FL',
      generatedAt: 'Mar 1, 2026 at 11:00 AM',
      status: 'processing',
      format: 'csv',
    },
  ];

  const reportTemplates = [
    {
      title: 'Executive Summary',
      description: 'High-level overview of platform sentiment and key metrics',
      icon: <TrendingUp size={24} color="#818CF8" />,
    },
    {
      title: 'Geographic Analysis',
      description: 'State and district-level sentiment breakdown',
      icon: <Map size={24} color="#818CF8" />,
    },
    {
      title: 'Issue Deep Dive',
      description: 'Comprehensive analysis of specific policy issues',
      icon: <Target size={24} color="#818CF8" />,
    },
    {
      title: 'Competitive Intelligence',
      description: 'Compare sentiment across multiple issues or bills',
      icon: <Building2 size={24} color="#818CF8" />,
    },
  ];

  const handleGenerateReport = (template: string) => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    Alert.alert(
      'Report Queued',
      `Your ${template} report is being generated. You'll receive an email when it's ready.`,
      [{ text: 'OK' }]
    );
  };

  const handleCustomReport = () => {
    if (!email) {
      Alert.alert('Email Required', 'Please enter an email address to receive the report.');
      return;
    }

    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setShowCustomReport(false);
    Alert.alert(
      'Custom Report Queued',
      `Your custom report is being generated and will be sent to ${email}`,
      [{ text: 'OK' }]
    );
  };

  const states = ['CA', 'TX', 'FL', 'NY', 'PA', 'OH', 'GA', 'NC', 'MI', 'AZ'];
  const issues = ['Healthcare', 'Immigration', 'Economy', 'Climate', 'Education', 'Crime'];

  return (
    <View className="flex-1 bg-slate-950">
      <LinearGradient
        colors={['#0F172A', '#1E1B4B', '#0F172A']}
        style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
      />

      <SafeAreaView className="flex-1">
        {/* Header */}
        <View className="flex-row items-center px-4 py-3 border-b border-slate-800/50">
          <TouchableOpacity onPress={() => router.back()} className="p-2 -ml-2">
            <ArrowLeft size={24} color="#94A3B8" />
          </TouchableOpacity>
          <View className="flex-1 ml-2">
            <Text className="text-white text-lg font-semibold">Reports</Text>
            <Text className="text-slate-400 text-sm">Generate custom analytics reports</Text>
          </View>
          <TouchableOpacity
            onPress={() => setShowCustomReport(true)}
            className="bg-indigo-500 px-4 py-2 rounded-xl"
          >
            <Text className="text-white font-medium">Custom</Text>
          </TouchableOpacity>
        </View>

        <ScrollView
          className="flex-1 px-4 py-4"
          showsVerticalScrollIndicator={false}
        >
          {/* Report Templates */}
          <Text className="text-white text-lg font-bold mb-3">Quick Reports</Text>
          {reportTemplates.map((template, index) => (
            <ReportTemplate
              key={index}
              title={template.title}
              description={template.description}
              icon={template.icon}
              onGenerate={() => handleGenerateReport(template.title)}
            />
          ))}

          {/* Generated Reports */}
          <View className="mt-6">
            <Text className="text-white text-lg font-bold mb-3">Recent Reports</Text>
            <View className="bg-slate-800/30 border border-slate-700/50 rounded-2xl p-4">
              {generatedReports.map((report) => (
                <GeneratedReport key={report.id} {...report} />
              ))}
            </View>
          </View>

          {/* Schedule Info */}
          <View className="mt-6 bg-indigo-500/10 border border-indigo-500/30 rounded-xl p-4 mb-8">
            <View className="flex-row items-center mb-2">
              <Calendar size={16} color="#818CF8" />
              <Text className="text-indigo-300 font-medium ml-2">Scheduled Reports</Text>
            </View>
            <Text className="text-slate-300 text-sm">
              Set up automated weekly or monthly reports to be delivered to your inbox.
              Contact your account manager to configure scheduled reporting.
            </Text>
          </View>
        </ScrollView>

        {/* Custom Report Modal */}
        <Modal
          visible={showCustomReport}
          transparent
          animationType="slide"
          onRequestClose={() => setShowCustomReport(false)}
        >
          <View className="flex-1 bg-black/50 justify-end">
            <View className="bg-slate-800 rounded-t-3xl p-6 max-h-[85%]">
              <View className="w-10 h-1 bg-slate-600 rounded-full self-center mb-4" />
              <View className="flex-row items-center justify-between mb-4">
                <Text className="text-white text-xl font-bold">Custom Report</Text>
                <TouchableOpacity onPress={() => setShowCustomReport(false)}>
                  <X size={24} color="#94A3B8" />
                </TouchableOpacity>
              </View>

              <ScrollView showsVerticalScrollIndicator={false}>
                {/* Date Range */}
                <Text className="text-slate-400 mb-2">Date Range</Text>
                <View className="flex-row gap-2 mb-6">
                  {['7', '14', '30', '90'].map((days) => (
                    <TouchableOpacity
                      key={days}
                      onPress={() => setDateRange(days)}
                      className={`flex-1 py-3 rounded-xl items-center ${
                        dateRange === days ? 'bg-indigo-500' : 'bg-slate-700'
                      }`}
                    >
                      <Text className={dateRange === days ? 'text-white font-medium' : 'text-slate-300'}>
                        {days}d
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>

                {/* States Filter */}
                <Text className="text-slate-400 mb-2">States (Optional)</Text>
                <View className="flex-row flex-wrap gap-2 mb-6">
                  {states.map((state) => (
                    <TouchableOpacity
                      key={state}
                      onPress={() => {
                        setSelectedStates((prev) =>
                          prev.includes(state)
                            ? prev.filter((s) => s !== state)
                            : [...prev, state]
                        );
                      }}
                      className={`px-4 py-2 rounded-full ${
                        selectedStates.includes(state) ? 'bg-indigo-500' : 'bg-slate-700'
                      }`}
                    >
                      <Text className={selectedStates.includes(state) ? 'text-white' : 'text-slate-300'}>
                        {state}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>

                {/* Issues Filter */}
                <Text className="text-slate-400 mb-2">Issues (Optional)</Text>
                <View className="flex-row flex-wrap gap-2 mb-6">
                  {issues.map((issue) => (
                    <TouchableOpacity
                      key={issue}
                      onPress={() => {
                        setSelectedIssues((prev) =>
                          prev.includes(issue)
                            ? prev.filter((i) => i !== issue)
                            : [...prev, issue]
                        );
                      }}
                      className={`px-4 py-2 rounded-full ${
                        selectedIssues.includes(issue) ? 'bg-indigo-500' : 'bg-slate-700'
                      }`}
                    >
                      <Text className={selectedIssues.includes(issue) ? 'text-white' : 'text-slate-300'}>
                        {issue}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>

                {/* Format */}
                <Text className="text-slate-400 mb-2">Format</Text>
                <View className="flex-row gap-2 mb-6">
                  <TouchableOpacity
                    onPress={() => setReportFormat('pdf')}
                    className={`flex-1 py-3 rounded-xl items-center ${
                      reportFormat === 'pdf' ? 'bg-indigo-500' : 'bg-slate-700'
                    }`}
                  >
                    <Text className={reportFormat === 'pdf' ? 'text-white font-medium' : 'text-slate-300'}>
                      PDF Report
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() => setReportFormat('csv')}
                    className={`flex-1 py-3 rounded-xl items-center ${
                      reportFormat === 'csv' ? 'bg-indigo-500' : 'bg-slate-700'
                    }`}
                  >
                    <Text className={reportFormat === 'csv' ? 'text-white font-medium' : 'text-slate-300'}>
                      CSV Data
                    </Text>
                  </TouchableOpacity>
                </View>

                {/* Email */}
                <Text className="text-slate-400 mb-2">Delivery Email</Text>
                <View className="flex-row items-center bg-slate-700 rounded-xl px-4 py-2 mb-6">
                  <Mail size={20} color="#64748B" />
                  <TextInput
                    className="flex-1 text-white ml-3 py-2"
                    placeholder="Enter email address"
                    placeholderTextColor="#64748B"
                    value={email}
                    onChangeText={setEmail}
                    keyboardType="email-address"
                    autoCapitalize="none"
                  />
                </View>

                {/* Generate Button */}
                <TouchableOpacity
                  onPress={handleCustomReport}
                  className="bg-indigo-500 py-4 rounded-xl items-center"
                >
                  <Text className="text-white font-bold">Generate Report</Text>
                </TouchableOpacity>
              </ScrollView>
            </View>
          </View>
        </Modal>
      </SafeAreaView>
    </View>
  );
}
